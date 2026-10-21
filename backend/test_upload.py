import io
import json
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routes_data


class UploadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.upload_patch = patch.object(routes_data, 'UPLOAD_DIR', self.temp.name)
        self.upload_patch.start()
        self.original_ids = set(routes_data.uploaded_data)
        app = FastAPI()
        app.include_router(routes_data.router)
        self.client = TestClient(app)
        self.frames = {
            '人口': pd.DataFrame({'市町村': ['水戸市', '日立市'], '人口': [100, 200]}),
            '施設': pd.DataFrame({'自治体': ['日立市', '水戸市'], '施設数': [4, 3]}),
        }

    def tearDown(self):
        for file_id in set(routes_data.uploaded_data) - self.original_ids:
            routes_data.uploaded_data.pop(file_id)
        self.client.close()
        self.upload_patch.stop()
        self.temp.cleanup()

    def workbook(self, frames=None):
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
            for name, frame in (self.frames if frames is None else frames).items():
                frame.to_excel(writer, sheet_name=name, index=False)
        return buffer.getvalue()

    def upload(self, selected=None, keys=None, frames=None, raw=None):
        data = {} if selected is None else {'sheet_names': json.dumps(selected)}
        if keys is not None:
            data['join_keys'] = json.dumps(keys)
        if raw is not None:
            data.update(raw)
        return self.client.post('/api/upload', files={'file': ('data.xlsx', self.workbook(frames))}, data=data)

    def test_list_sheets_does_not_register_dataset(self):
        response = self.client.post('/api/upload/sheets', files={'file': ('data.xlsx', self.workbook())})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['sheets'], [
            {'name': '人口', 'rows': 2, 'columns': ['市町村', '人口']},
            {'name': '施設', 'rows': 2, 'columns': ['自治体', '施設数']},
        ])
        self.assertEqual(set(routes_data.uploaded_data), self.original_ids)

    def test_legacy_upload_uses_first_sheet(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['selected_sheets'], ['人口'])
        self.assertEqual(response.json()['rows'], 2)

    def test_select_non_first_sheet(self):
        response = self.upload(['施設'])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['preview'][0], {'自治体': '日立市', '施設数': 4})

    def test_merge_aligns_keys_and_preserves_base_order(self):
        response = self.upload(['人口', '施設'], {'人口': '市町村', '施設': '自治体'})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['rows'], 2)
        self.assertEqual(result['preview'], [
            {'市町村': '水戸市', '人口': 100, '施設 / 施設数': 3},
            {'市町村': '日立市', '人口': 200, '施設 / 施設数': 4},
        ])
        self.assertEqual(result['warnings'], [])

    def test_selected_first_sheet_is_base_and_keys_are_trimmed(self):
        self.frames['施設'].loc[0, '自治体'] = ' 日立市 '
        response = self.upload(['施設', '人口'], {'人口': '市町村', '施設': '自治体'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['preview'][0]['人口 / 人口'], 200)
        self.assertEqual(response.json()['preview'][1]['人口 / 人口'], 100)

    def test_unmatched_rows_are_not_added_and_are_reported(self):
        self.frames['施設'].loc[0, '自治体'] = '土浦市'
        response = self.upload(['人口', '施設'], {'人口': '市町村', '施設': '自治体'})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['rows'], 2)
        self.assertIsNone(result['preview'][1]['施設 / 施設数'])
        self.assertEqual(len(result['warnings']), 2)

    def test_duplicate_and_missing_keys_are_rejected(self):
        for values in [['水戸市', ' 水戸市 '], ['水戸市', None], ['水戸市', ' ']]:
            with self.subTest(values=values):
                self.frames['施設']['自治体'] = values
                response = self.upload(['人口', '施設'], {'人口': '市町村', '施設': '自治体'})
                self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(set(routes_data.uploaded_data), self.original_ids)

    def test_base_duplicate_key_is_also_rejected(self):
        self.frames['人口']['市町村'] = ['水戸市', '水戸市']
        response = self.upload(['人口', '施設'], {'人口': '市町村', '施設': '自治体'})
        self.assertEqual(response.status_code, 400, response.text)

    def test_invalid_sheet_options_are_rejected(self):
        for selected in [[], ['存在しない'], ['人口', '人口'], '人口', [3], {'人口': True}]:
            with self.subTest(selected=selected):
                self.assertEqual(self.upload(selected).status_code, 400)
        for raw in [{'sheet_names': '{'}, {'sheet_names': 'null'}, {'join_keys': '[]'}]:
            with self.subTest(raw=raw):
                self.assertEqual(self.upload(raw=raw).status_code, 400)
        for keys in [{}, {'人口': '市町村', '施設': '存在しない'}]:
            self.assertEqual(self.upload(['人口', '施設'], keys).status_code, 400)

    def test_empty_sheet_and_invalid_file_are_rejected(self):
        self.assertEqual(self.upload(['空'], frames={'空': pd.DataFrame()}).status_code, 400)
        response = self.client.post('/api/upload/sheets', files={'file': ('bad.xlsx', b'invalid')})
        self.assertEqual(response.status_code, 400)

    def test_csv_tsv_and_uppercase_extension_remain_supported(self):
        for filename, contents in [('data.csv', b'x,y\n1,2\n'), ('data.tsv', b'x\ty\n1\t2\n')]:
            response = self.client.post('/api/upload', files={'file': (filename, contents)})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['preview'], [{'x': 1, 'y': 2}])
        response = self.client.post('/api/upload', files={'file': ('data.XLSX', self.workbook())})
        self.assertEqual(response.status_code, 200, response.text)


if __name__ == '__main__':
    unittest.main()
