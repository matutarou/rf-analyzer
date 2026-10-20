import os
import unittest
from unittest.mock import patch

from main import resolve_port


class PortConfigTest(unittest.TestCase):
    def test_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(resolve_port('RF_BACKEND_PORT', 8780), 8780)
            self.assertEqual(resolve_port('RF_FRONTEND_PORT', 5280), 5280)

    def test_valid_overrides(self):
        for env_name in ('RF_BACKEND_PORT', 'RF_FRONTEND_PORT'):
            for value in ('1', '9000', '65535'):
                with self.subTest(env_name=env_name, value=value):
                    with patch.dict(os.environ, {env_name: value}):
                        self.assertEqual(resolve_port(env_name, 8780), int(value))

    def test_non_integer(self):
        for env_name in ('RF_BACKEND_PORT', 'RF_FRONTEND_PORT'):
            for value in ('abc', '', '9000.5'):
                with self.subTest(env_name=env_name, value=value):
                    with patch.dict(os.environ, {env_name: value}):
                        with self.assertRaisesRegex(ValueError, env_name):
                            resolve_port(env_name, 8780)

    def test_out_of_range(self):
        for env_name in ('RF_BACKEND_PORT', 'RF_FRONTEND_PORT'):
            for value in ('0', '-1', '65536'):
                with self.subTest(env_name=env_name, value=value):
                    with patch.dict(os.environ, {env_name: value}):
                        with self.assertRaisesRegex(ValueError, env_name):
                            resolve_port(env_name, 8780)


if __name__ == '__main__':
    unittest.main()
