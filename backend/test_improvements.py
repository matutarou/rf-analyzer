import asyncio
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

import assistant
import main
import rag
import routes_analysis


class ImprovementsTest(unittest.TestCase):
    def test_context(self):
        context = assistant._build_context({
            "metrics": {"cv": {"r2": .82, "method": "loo"}},
            "shap": {"importance": [{"feature": "population", "mean_abs_shap": 2}]},
        })
        self.assertIn("0.8200", context)
        self.assertIn("loo", context)
        self.assertIn("population", context)
        self.assertNotIn("5-Fold", context)
        self.assertIn("R²: 不明", assistant._build_context({}))

    def test_search_threshold(self):
        chunks = [rag.Chunk("a.txt", 0, "本文", np.array([1., 0.]))]

        async def embed(client, texts):
            return [np.array([0., 1.])]

        with patch.object(rag, "_load", return_value=chunks), patch.object(rag, "_embed", embed):
            self.assertEqual(asyncio.run(rag.search(None, "質問")), [])

    def test_pdf_pages(self):
        async def embed(client, texts):
            return [np.array([1., 0.]) for _ in texts]

        with patch.object(rag, "_load", return_value=[]), patch.object(rag, "_embed", embed), patch.object(rag, "_save") as save:
            asyncio.run(rag.ingest(None, "a.pdf", "本文1\f本文2"))
            self.assertEqual([c.page for c in save.call_args.args[0]], [1, 2])

    def test_analysis_and_cancel(self):
        main.uploaded_data["test"] = pd.DataFrame({"x": range(10), "y": range(10)})
        req = main.AnalyzeRequest(file_id="test", target_column="y", feature_columns=["x"], n_estimators=2)
        updates = []
        result = main._analyze(req, updates.append)
        self.assertIn("r2", result["metrics"]["cv"])
        self.assertTrue(any("10/10" in u for u in updates))
        entered = threading.Event()
        release = threading.Event()

        def slow(req, checkpoint):
            entered.set()
            release.wait(5)
            checkpoint("処理中")

        with patch.object(routes_analysis, "_analyze", slow):
            job_id = main.start_analysis_job(req)["job_id"]
            self.assertTrue(entered.wait(5))
            main.cancel_analysis_job(job_id)
            release.set()
            for _ in range(100):
                if main.get_analysis_job(job_id)["status"] == "cancelled":
                    break
                time.sleep(.01)
            self.assertEqual(main.get_analysis_job(job_id)["status"], "cancelled")
        main.uploaded_data.pop("test", None)
        main.trained_models.pop("test", None)
        main.model_artifacts.pop("test", None)


if __name__ == "__main__":
    unittest.main()
