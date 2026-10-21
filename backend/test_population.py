import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routes_data
import workspace


class PopulationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.upload_patch = patch.object(routes_data, 'UPLOAD_DIR', self.temp.name)
        self.db_patch = patch.object(workspace, 'DB_PATH', Path(self.temp.name) / 'workspace.sqlite3')
        self.upload_patch.start()
        self.db_patch.start()
        self.original_ids = set(routes_data.uploaded_data)
        app = FastAPI()
        app.include_router(routes_data.router)
        app.include_router(workspace.create_router(routes_data.uploaded_data, {}, {}))
        self.client = TestClient(app)
        self.frame = pd.DataFrame({
            '市町村': ['水戸市'] * 6 + ['日立市'] * 2,
            '性別': ['男', '女', '男', '女', '男', '女', '男', '女'],
            '年齢': [0, 0, 4, 5, 99, 100, 0, 0],
            '人口': [10, 12, 5, 8, 1, 2, 0, 0],
        })
        self.config = {'sheet_name': '人口ピラミッド', 'municipality_column': '市町村',
                       'sex_column': '性別', 'age_column': '年齢', 'population_column': '人口'}

    def tearDown(self):
        for file_id in set(routes_data.uploaded_data) - self.original_ids:
            routes_data.uploaded_data.pop(file_id)
        self.client.close()
        self.upload_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    def workbook(self):
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
            pd.DataFrame({'市町村': ['水戸市', '日立市'], '率': [0.1, -0.2]}).to_excel(writer, sheet_name='分析', index=False)
            self.frame.to_excel(writer, sheet_name='人口ピラミッド', index=False)
        return buffer.getvalue()

    def upload(self, endpoint='/api/population-pyramid', extra=None):
        data = {'pyramid_config': json.dumps(self.config)}
        data.update(extra or {})
        return self.client.post(endpoint, files={'file': ('population.xlsx', self.workbook())}, data=data)

    def test_aggregates_five_year_bands_and_preserves_totals(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['sheet_name'], '人口ピラミッド')
        self.assertEqual(result['warnings'], [])
        self.assertEqual([city['name'] for city in result['cities']], ['水戸市', '日立市'])
        bands = result['cities'][0]['bands']
        self.assertEqual(len(bands), 21)
        self.assertEqual(bands[0], {'age_start': 0, 'male': 15, 'female': 12})
        self.assertEqual(bands[1], {'age_start': 5, 'male': 0, 'female': 8})
        self.assertEqual(bands[-1], {'age_start': 100, 'male': 0, 'female': 2})
        self.assertEqual(sum(band['male'] + band['female'] for band in bands), 38)
        self.assertEqual(set(routes_data.uploaded_data), self.original_ids)

    def test_visualization_sheet_is_not_joined_to_analysis(self):
        response = self.upload('/api/upload', {'sheet_names': json.dumps(['分析'])})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['rows'], 2)
        self.assertEqual([column['name'] for column in result['columns']], ['市町村', '率'])
        self.assertEqual(len(result['population_pyramid']['cities']), 2)
        rejected = self.upload('/api/upload', {'sheet_names': json.dumps(['人口ピラミッド'])})
        self.assertEqual(rejected.status_code, 400)

    def test_population_data_survives_save_and_restore_without_training_data(self):
        pyramid = self.upload().json()
        response = self.client.post('/api/projects', json={'name': '人口表示', 'population_pyramid': pyramid})
        self.assertEqual(response.status_code, 201, response.text)
        restored = self.client.post(f"/api/projects/{response.json()['id']}/restore")
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()['state']['population_pyramid'], pyramid)
        self.assertIsNone(restored.json()['file_info'])

    def test_population_data_survives_save_with_analysis_data(self):
        result = self.upload('/api/upload', {'sheet_names': json.dumps(['分析'])}).json()
        saved = self.client.post('/api/projects', json={'name': '分析と人口', 'file_id': result['file_id'], 'population_pyramid': result['population_pyramid']})
        self.assertEqual(saved.status_code, 201, saved.text)
        restored = self.client.post(f"/api/projects/{saved.json()['id']}/restore").json()
        self.assertEqual(restored['file_info']['rows'], 2)
        self.assertEqual(restored['state']['population_pyramid'], result['population_pyramid'])

    def test_invalid_ages_populations_and_missing_values_are_rejected(self):
        for column, value in [('年齢', '0〜4歳'), ('年齢', '80歳以上'), ('年齢', -1), ('年齢', 0.5),
                              ('人口', '非数値'), ('人口', 1.5), ('人口', float('inf')), ('人口', float('-inf')), ('人口', None),
                              ('性別', '不明'), ('市町村', ' ')]:
            with self.subTest(column=column, value=value):
                frame = self.frame.copy()
                self.frame[column] = self.frame[column].astype(object)
                self.frame.loc[0, column] = value
                self.assertEqual(self.upload().status_code, 400)
                self.frame = frame

    def test_negative_populations_are_aggregated_and_warned_on_both_endpoints(self):
        self.frame.loc[0, '人口'] = -10
        self.frame.loc[5, '人口'] = -2
        for endpoint, extra in [('/api/population-pyramid', {}), ('/api/upload', {'sheet_names': json.dumps(['分析'])})]:
            with self.subTest(endpoint=endpoint):
                response = self.upload(endpoint, extra)
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                pyramid = result['population_pyramid'] if endpoint == '/api/upload' else result
                bands = pyramid['cities'][0]['bands']
                self.assertEqual(bands[0]['male'], -5)
                self.assertEqual(bands[-1]['female'], -2)
                self.assertEqual(sum(band['male'] + band['female'] for band in bands), 14)
                self.assertEqual(len(pyramid['warnings']), 1)
                self.assertIn('マイナスの行が2件', pyramid['warnings'][0])
                self.assertIn('水戸市 男 0歳', pyramid['warnings'][0])
                self.assertIn('水戸市 女 100歳', pyramid['warnings'][0])
                self.assertIn('そのまま集計しています', pyramid['warnings'][0])
                if endpoint == '/api/upload':
                    self.assertEqual(result['rows'], 2)

    def test_negative_populations_and_warnings_survive_save_and_restore(self):
        self.frame.loc[0, '人口'] = -10
        self.frame.loc[5, '人口'] = -2
        pyramid = self.upload().json()
        saved = self.client.post('/api/projects', json={'name': '負の人口', 'population_pyramid': pyramid})
        self.assertEqual(saved.status_code, 201, saved.text)
        restored = self.client.post(f"/api/projects/{saved.json()['id']}/restore")
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()['state']['population_pyramid'], pyramid)
        self.assertEqual(pyramid['cities'][0]['bands'][0]['male'], -5)
        self.assertEqual(pyramid['cities'][0]['bands'][-1]['female'], -2)
        self.assertTrue(pyramid['warnings'])

    def test_old_population_data_without_warnings_can_be_restored(self):
        pyramid = self.upload().json()
        pyramid.pop('warnings')
        saved = self.client.post('/api/projects', json={'name': '既存人口', 'population_pyramid': pyramid})
        self.assertEqual(saved.status_code, 201, saved.text)
        restored = self.client.post(f"/api/projects/{saved.json()['id']}/restore")
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()['state']['population_pyramid'], {**pyramid, 'warnings': []})

    def test_negative_population_warning_limits_examples_but_counts_all_rows(self):
        self.frame['人口'] = -1
        pyramid = self.upload().json()
        self.assertIn('マイナスの行が8件', pyramid['warnings'][0])
        self.assertIn('水戸市 男 4歳', pyramid['warnings'][0])
        self.assertNotIn('日立市', pyramid['warnings'][0])

    def test_age_and_sex_labels_are_normalized(self):
        self.frame['年齢'] = self.frame['年齢'].astype(object)
        self.frame.loc[5, '年齢'] = '100歳以上'
        self.frame.loc[0, '性別'] = ' 男性 '
        self.frame.loc[1, '性別'] = 'female'
        self.assertEqual(self.upload().status_code, 200)

    def test_invalid_configuration_and_non_excel_are_rejected(self):
        self.config['sheet_name'] = '存在しない'
        self.assertEqual(self.upload().status_code, 400)
        self.config['sheet_name'] = '人口ピラミッド'
        self.config['age_column'] = '性別'
        self.assertEqual(self.upload().status_code, 400)
        response = self.client.post('/api/population-pyramid', files={'file': ('data.csv', b'age,count')}, data={'pyramid_config': '{}'})
        self.assertEqual(response.status_code, 400)
        response = self.client.post('/api/population-pyramid', files={'file': ('data.xlsx', self.workbook())}, data={'pyramid_config': '{'})
        self.assertEqual(response.status_code, 400)


if __name__ == '__main__':
    unittest.main()
