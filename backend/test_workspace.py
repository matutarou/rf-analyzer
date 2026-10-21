import asyncio
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

import assistant
import main
import workspace


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(workspace, 'DB_PATH', Path(self.temp.name) / 'db.sqlite3')
        self.db_patch.start()
        self.client = TestClient(main.app)
        self.file_id = 'workspace-test'
        self.df = pd.DataFrame({'name': ['a', 'b', 'c'] * 4, 'x': list(range(11)) + [None], 'y': list(range(0, 24, 2)), 'category': ['A', 'B'] * 6, 'constant': [1] * 12})
        main.uploaded_data[self.file_id] = self.df

    def tearDown(self):
        main.uploaded_data.pop(self.file_id, None)
        main.trained_models.pop(self.file_id, None)
        main.model_artifacts.pop(self.file_id, None)
        self.client.close()
        self.db_patch.stop()
        self.temp.cleanup()

    def save(self):
        return self.client.post('/api/projects', json={
            'file_id': self.file_id, 'name': '<script>alert(1)</script>', 'filename': 'test.csv',
            'target': 'y', 'features': ['x', 'category'], 'params': {'n_trials': 10, 'api_key': 'secret'},
            'results': {'metrics': {'cv': {'r2': .75, 'rmse': 2}}},
            'ai': {'summary': '<img src=x onerror=alert(1)>', 'api_key': 'secret'},
        })

    def test_quality_matches_preprocessing(self):
        response = self.client.post('/api/quality', json={'file_id': self.file_id, 'target': 'y', 'features': ['x', 'category']})
        self.assertEqual(response.status_code, 200)
        quality = response.json()
        X, y, encoders, used = main.preprocess_dataframe(self.df, ['x', 'category'], 'y')
        self.assertEqual(quality['included'], len(X))
        self.assertEqual(quality['excluded'][0], {'row': 12, 'columns': ['x']})
        self.assertEqual(quality['encoding']['category']['values'][0], {'value': 'A', 'code': 0})
        self.assertTrue(next(c for c in quality['columns'] if c['name'] == 'constant')['constant'])

    def test_leakage_and_infinity(self):
        quality = workspace.inspect_data(self.df, 'y', ['y'])
        self.assertTrue(quality['errors'])
        bad = self.df.copy()
        bad.loc[0, 'x'] = np.inf
        self.assertTrue(workspace.inspect_data(bad, 'y', ['x'])['errors'])
        request = main.AnalyzeRequest(file_id=self.file_id, target_column='y', feature_columns=['y'])
        with self.assertRaises(main.HTTPException):
            main._analyze(request)

    def test_correlations(self):
        response = self.client.post('/api/relationships', json={'file_id': self.file_id, 'target': 'y', 'features': ['x', 'constant', 'category']})
        pairs = response.json()['pairs']
        pair = next(p for p in pairs if {p['x'], p['y']} == {'x', 'y'})
        self.assertAlmostEqual(pair['r'], 1)
        self.assertEqual(pair['n'], 11)
        self.assertTrue(all(p['r'] is None for p in pairs if 'constant' in (p['x'], p['y'])))
        result = response.json()
        self.assertEqual(result['variables'], ['x', 'constant', 'y'])
        self.assertEqual(result['matrix'][0][2], result['matrix'][2][0])
        self.assertAlmostEqual(result['matrix'][0][2], 1)
        self.assertEqual(result['counts'][0][2], 11)
        self.assertIsNone(result['matrix'][1][1])
        self.assertIn('y', result['available'])
        self.assertNotIn('category', result['available'])

    def test_heatmap_missing_infinite_and_insufficient_values(self):
        main.uploaded_data[self.file_id] = pd.DataFrame({'x': [1, 2, 3, 4], 'negative': [-1, -2, -3, -4], 'sparse': [1, None, float('inf'), 4]})
        result = self.client.post('/api/relationships', json={'file_id': self.file_id}).json()
        self.assertAlmostEqual(result['matrix'][0][1], -1)
        self.assertEqual(result['counts'][0][2], 2)
        self.assertIsNone(result['matrix'][0][2])
        self.assertIsNone(result['matrix'][2][2])

    def test_heatmap_limit_is_explicit_and_variables_can_be_selected(self):
        main.uploaded_data[self.file_id] = pd.DataFrame({f'x{index}': range(4) for index in range(45)})
        result = self.client.post('/api/relationships', json={'file_id': self.file_id}).json()
        self.assertEqual(len(result['variables']), 40)
        self.assertEqual(len(result['available']), 45)
        self.assertTrue(result['truncated'])
        selected = self.client.post('/api/relationships', json={'file_id': self.file_id, 'features': ['x44', 'x0']}).json()
        self.assertEqual(selected['variables'], ['x44', 'x0'])
        self.assertFalse(selected['truncated'])

    def test_save_restore_report_delete(self):
        response = self.save()
        self.assertEqual(response.status_code, 201, response.text)
        project_id = response.json()['id']
        with workspace.connect() as db:
            stored = db.execute('SELECT state FROM projects').fetchone()['state']
        self.assertNotIn('secret', stored)
        main.uploaded_data.pop(self.file_id)
        restored = self.client.post(f'/api/projects/{project_id}/restore').json()
        file_id = restored['file_info']['file_id']
        pd.testing.assert_frame_equal(main.uploaded_data[file_id], self.df, check_dtype=False)
        main.uploaded_data.pop(file_id)
        self.assertEqual(restored['state']['results']['metrics']['cv']['r2'], .75)
        self.assertEqual(next(c for c in restored['file_info']['columns'] if c['name'] == 'x')['max'], 10)
        listing = self.client.get('/api/projects').json()
        self.assertEqual(len(listing), 1)
        report = self.client.get(f'/api/projects/{project_id}/report')
        self.assertEqual(report.status_code, 200)
        self.assertNotIn('<script>', report.text)
        self.assertNotIn('<img src=x', report.text)
        self.assertIn('0.75', report.text)
        self.assertEqual(self.client.delete(f'/api/projects/{project_id}').status_code, 200)
        self.assertEqual(self.client.post(f'/api/projects/{project_id}/restore').status_code, 404)

    def test_feedback(self):
        response = self.client.post('/api/feedback', json={'rating': 'incorrect', 'answer': '回答', 'comment': '数値が違う'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.client.get('/api/feedback').json()[0]['comment'], '数値が違う')
        self.assertEqual(self.client.post('/api/feedback', json={'rating': 'bad', 'answer': '回答'}).status_code, 422)

    def test_lossless_dataset(self):
        df = pd.DataFrame({'tiny': [1e-12, 1.123456789012345, np.nan],
                           'large': pd.Series([2**60 + 1, 2**60 + 2, 3], dtype='int64'),
                           'text': ['001', None, '日本語']})
        restored = workspace.decode_dataset(workspace.encode_dataset(df))
        pd.testing.assert_frame_equal(df, restored, check_exact=True)
        main.uploaded_data[self.file_id] = df
        saved = self.client.post('/api/projects', json={'file_id': self.file_id, 'name': '精度確認'}).json()
        record = self.client.post(f"/api/projects/{saved['id']}/restore").json()
        pd.testing.assert_frame_equal(df, main.uploaded_data.pop(record['file_info']['file_id']), check_exact=True)

    def test_legacy_dataset(self):
        restored = workspace.decode_dataset(self.df.to_json(orient='table', index=False))
        pd.testing.assert_frame_equal(self.df, restored, check_dtype=False)

    def test_update_draft_chat_and_conflict(self):
        project_id = str(uuid.uuid4())
        url = f'/api/projects/{project_id}'
        payload = {'name': '作業中', 'chat': {'input': '下書き', 'api_key': 'secret'},
                   'view': {'assistant_tab': 'chat', 'api_key': 'secret'}}
        response = self.client.put(url, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['version'], 1)
        draft = self.client.post(url + '/restore').json()
        self.assertIsNone(draft['file_info'])
        self.assertEqual(draft['state']['chat']['input'], '下書き')
        self.assertNotIn('secret', json.dumps(draft))
        payload.update(file_id=self.file_id, expected_version=1, target='y', features=['x'])
        payload['chat']['messages'] = [{'role': 'user', 'content': '質問'}, {'role': 'assistant', 'content': '回答'}]
        self.assertEqual(self.client.put(url, json=payload).status_code, 200)
        self.assertEqual(len(self.client.get('/api/projects').json()), 1)
        self.assertEqual(self.client.put(url, json=payload).status_code, 409)
        restored = self.client.post(url + '/restore').json()
        main.uploaded_data.pop(restored['file_info']['file_id'])
        self.assertEqual(restored['state']['features'], ['x'])
        self.assertEqual(restored['state']['chat']['messages'][1]['content'], '回答')
        payload.update(expected_version=2, chat={'messages': [], 'input': '', 'screen_context': ''}, results={'metrics': {'cv': {'r2': .5}}})
        self.assertEqual(self.client.put(url, json=payload).status_code, 200)
        self.assertEqual(self.client.get('/api/projects?compact=true').json()[0]['version'], 3)
        reset = self.client.post(url + '/restore').json()
        main.uploaded_data.pop(reset['file_info']['file_id'])
        self.assertEqual(reset['state']['chat']['messages'], [])
        self.assertEqual(reset['state']['results']['metrics']['cv']['r2'], .5)
        self.assertEqual(reset['state']['features'], ['x'])

    def test_rows_with_missing_values(self):
        response = self.client.get(f'/api/rows/{self.file_id}')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['rows'][-1]['x'])

    def test_category_baseline_prediction(self):
        main._analyze(main.AnalyzeRequest(file_id=self.file_id, target_column='y', feature_columns=['x', 'category'], n_estimators=2))
        response = self.client.post('/api/predict_marginal_fast', json={
            'file_id': self.file_id, 'target_column': 'y', 'feature_columns': ['x', 'category'],
            'baseline_input': {'x': 5}, 'sim_input': {'x': 6}, 'changed_features': ['x'],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['fixed_categories'], {'category': 'A'})

    def test_synthesis_and_screen_context(self):
        create = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='共通点: 数値'))]))
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        summary = asyncio.run(assistant.synthesize(client, 'test', {'metrics': {'cv': {'r2': .75}}}, []))
        self.assertIn('共通点', summary)
        self.assertIn('0.7500', create.call_args.kwargs['messages'][1]['content'])
        with patch.object(assistant.rag, 'search', AsyncMock(return_value=[])):
            asyncio.run(assistant.chat(client, 'test', '質問', [], None, '相関=0.8'))
        self.assertIn('相関=0.8', create.call_args.kwargs['messages'][0]['content'])


if __name__ == '__main__':
    unittest.main()
