import copy
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from sklearn.ensemble import RandomForestRegressor

import main
import model_store
import workspace


class ModelHistoryTest(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.object(workspace, 'DB_PATH', Path(directory) / 'workspace.sqlite3'))
        for cache in (main.uploaded_data, main.trained_models, main.model_artifacts):
            self.stack.enter_context(patch.dict(cache, {}, clear=True))
        self.client = self.stack.enter_context(TestClient(main.app))
        self.df = pd.DataFrame({'name': [f'行{i}' for i in range(12)],
                                'x': [1.123456789012345] + list(range(1, 12)),
                                'category': ['A', 'B'] * 6, 'y': list(range(0, 24, 2)),
                                'other': list(range(12))})
        self.file_id = 'model-test'
        main.uploaded_data[self.file_id] = self.df
        self.request = main.AnalyzeRequest(file_id=self.file_id, target_column='y',
                                           feature_columns=['x', 'category'], n_estimators=3, random_state=19)
        self.results = main._analyze(self.request)
        self.payload = {'file_id': self.file_id, 'name': 'モデル検証', 'target': 'y',
                        'features': ['x', 'category'], 'params': self.request.model_dump(), 'results': self.results}

    def tearDown(self):
        self.stack.close()

    def save(self, payload=None):
        response = self.client.post('/api/projects', json=payload or self.payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def predict(self, file_id, **extra):
        return self.client.post('/api/predict_marginal_fast', json={
            'file_id': file_id, 'target_column': 'y', 'feature_columns': ['x', 'category'],
            'model_id': self.results['model_id'], 'baseline_input': {'x': 4},
            'sim_input': {'x': 6}, 'changed_features': ['x'], **extra,
        })

    def test_restore_without_training_and_identical_predictions(self):
        expected = self.predict(self.file_id).json()
        project_id = self.save()
        main.uploaded_data.clear(); main.trained_models.clear(); main.model_artifacts.clear()
        with patch.object(RandomForestRegressor, 'fit', side_effect=AssertionError('再学習は禁止')):
            response = self.client.post(f'/api/projects/{project_id}/restore')
            self.assertEqual(response.status_code, 200, response.text)
            restored = response.json()
            self.assertTrue(restored['model_status']['available'], restored)
            new_id = restored['file_info']['file_id']
            prediction = self.predict(new_id)
            self.assertEqual(prediction.status_code, 200, prediction.text)
        for field in ('baseline', 'simulation', 'delta'):
            self.assertAlmostEqual(prediction.json()[field], expected[field], places=12)
        self.assertEqual(prediction.json()['fixed_categories'], {'category': 'A'})
        self.assertEqual(restored['state']['trained_params']['random_state'], 19)
        self.assertEqual(restored['state']['trained_params']['n_estimators'], 3)
        pd.testing.assert_frame_equal(main.uploaded_data[new_id], self.df, check_exact=True)

    def test_json_numeric_round_trip_keeps_model(self):
        payload = copy.deepcopy(self.payload)
        payload['results'] = json.loads(json.dumps(payload['results']), parse_float=lambda s: int(float(s)) if float(s).is_integer() else float(s))
        restored = self.client.post(f'/api/projects/{self.save(payload)}/restore').json()
        self.assertTrue(restored['model_status']['available'])

    def test_changed_conditions_do_not_save_stale_model(self):
        for changes in ({'target': 'other'}, {'features': ['category', 'x']},
                        {'params': {**self.payload['params'], 'random_state': 20}}, {'results': None}):
            with self.subTest(changes=changes):
                payload = {**self.payload, **changes}
                record = self.client.post(f'/api/projects/{self.save(payload)}/restore').json()
                self.assertFalse(record['model_status']['available'])
                self.assertIsNone(record['state']['trained_params'])
        main.uploaded_data[self.file_id] = self.df.assign(x=self.df.x + 1)
        record = self.client.post(f'/api/projects/{self.save()}/restore').json()
        self.assertFalse(record['model_status']['available'])

    def test_prediction_rejects_wrong_model_target_or_order(self):
        for changes in ({'target_column': 'other'}, {'feature_columns': ['category', 'x']}, {'model_id': 'old'}):
            self.assertEqual(self.predict(self.file_id, **changes).status_code, 409)

    def test_unchanged_inputs_have_exactly_zero_effect(self):
        restored = self.client.post(f'/api/projects/{self.save()}/restore').json()
        response = self.predict(restored['file_info']['file_id'], sim_input={'x': 4})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['delta'], 0)
        self.assertEqual(response.json()['marginal_effects'][0]['effect'], 0)

    def test_corruption_does_not_load_model_or_lose_results(self):
        project_id = self.save()
        with workspace.connect() as db:
            db.execute('UPDATE model_artifacts SET payload=?', (b'broken',))
        with patch.object(model_store.skops.io, 'loads', side_effect=AssertionError('破損ファイルの読み込みは禁止')):
            restored = self.client.post(f'/api/projects/{project_id}/restore').json()
        self.assertFalse(restored['model_status']['available'])
        self.assertIn('破損', restored['model_status']['reason'])
        self.assertEqual(restored['state']['results']['model_id'], self.results['model_id'])

    def test_incompatible_model_survives_auto_save(self):
        project_id = self.save()
        with patch.object(model_store, 'runtime_versions', return_value={'python': 'future'}):
            restored = self.client.post(f'/api/projects/{project_id}/restore').json()
        self.assertFalse(restored['model_status']['available'])
        payload = {**restored['state'], 'file_id': restored['file_info']['file_id'], 'expected_version': restored['version']}
        self.assertEqual(self.client.put(f'/api/projects/{project_id}', json=payload).status_code, 200)
        restored = self.client.post(f'/api/projects/{project_id}/restore').json()
        self.assertTrue(restored['model_status']['available'])

    def test_copies_share_model_and_delete_cleans_unreferenced_model(self):
        first, second = self.save(), self.save()
        with workspace.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM model_artifacts').fetchone()[0], 1)
        self.client.delete(f'/api/projects/{first}')
        self.assertTrue(self.client.post(f'/api/projects/{second}/restore').json()['model_status']['available'])
        self.client.delete(f'/api/projects/{second}')
        with workspace.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM model_artifacts').fetchone()[0], 0)

    def test_updating_conditions_detaches_model(self):
        project_id = self.save()
        payload = {**self.payload, 'expected_version': 1, 'results': None}
        self.assertEqual(self.client.put(f'/api/projects/{project_id}', json=payload).status_code, 200)
        with workspace.connect() as db:
            self.assertIsNone(db.execute('SELECT model_id FROM projects WHERE id=?', (project_id,)).fetchone()[0])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM model_artifacts').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
