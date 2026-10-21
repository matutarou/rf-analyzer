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

    def test_optimization_history(self):
        history = routes_analysis.optimization_history([0.2, None, 0.1, 0.5, float("nan")])
        self.assertEqual([h["value"] for h in history], [0.2, None, 0.1, 0.5, None])
        self.assertEqual([h["best"] for h in history], [0.2, 0.2, 0.2, 0.5, 0.5])
        self.assertEqual([h["trial"] for h in history], [1, 2, 3, 4, 5])
        main.uploaded_data["history"] = pd.DataFrame({"x": range(10), "y": range(10)})
        req = main.AnalyzeRequest(file_id="history", target_column="y", feature_columns=["x"], optimize=True, n_trials=2)
        result = main._analyze(req)
        self.assertEqual(len(result["optimization_history"]), 2)
        self.assertNotIn("history", result["best_params"])
        self.assertAlmostEqual(result["optimization_history"][-1]["best"], result["best_params"]["best_cv_score"])
        for key in ("history",):
            main.uploaded_data.pop(key, None); main.trained_models.pop(key, None); main.model_artifacts.pop(key, None)

    def test_shap_uses_model_without_target_row(self):
        from sklearn.base import clone
        from sklearn.ensemble import RandomForestRegressor
        rng = np.random.default_rng(0)
        X = rng.normal(size=(12, 3))
        y = X[:, 0] * 2 + X[:, 1] + rng.normal(scale=0.1, size=12)
        model = RandomForestRegressor(n_estimators=5, random_state=7)
        predictions, values = routes_analysis._loo_predictions(model, X, y, lambda message: None, "検証", explain=True)
        for row in (0, 5, 11):
            others = np.delete(np.arange(12), row)
            fold = clone(model).fit(X[others], y[others])
            self.assertAlmostEqual(predictions[row], fold.predict(X[[row]])[0])
            np.testing.assert_allclose(values[row], routes_analysis.shap.TreeExplainer(fold).shap_values(X[[row]])[0])
        # SHAPを求めない場合は従来どおり予測だけを返す
        np.testing.assert_allclose(routes_analysis._loo_predictions(model, X, y, lambda message: None, "検証"), predictions)
        main.uploaded_data["oof-shap"] = pd.DataFrame({"a": X[:, 0], "b": X[:, 1], "c": X[:, 2], "y": y})
        req = main.AnalyzeRequest(file_id="oof-shap", target_column="y", feature_columns=["a", "b", "c"], n_estimators=5, random_state=7)
        result = main._analyze(req)
        expected = np.abs(values).mean(axis=0)
        for item in result["shap"]["importance"]:
            self.assertAlmostEqual(item["mean_abs_shap"], expected[["a", "b", "c"].index(item["feature"])])
        self.assertEqual(result["shap"]["features"], ["a", "b", "c"])
        self.assertEqual(result["shap"]["rows"], list(range(12)))
        np.testing.assert_allclose(result["shap"]["values"], values)
        self.assertEqual({point["row"] for point in result["shap"]["beeswarm"]}, set(range(12)))
        # 欠損行を除外しても、元データの行番号と名前（先頭列）で対応付ける
        frame = pd.DataFrame({"name": [f"市{i}" for i in range(12)], "a": X[:, 0], "y": y})
        frame.loc[2, "a"] = None
        main.uploaded_data["oof-shap"] = frame
        missing = main._analyze(main.AnalyzeRequest(file_id="oof-shap", target_column="y", feature_columns=["a"], n_estimators=5, random_state=7))
        self.assertEqual(missing["shap"]["rows"], [0, 1] + list(range(3, 12)))
        self.assertEqual(len(missing["shap"]["values"]), 11)
        self.assertEqual({point["label"] for point in missing["shap"]["beeswarm"]}, {f"市{i}" for i in range(12) if i != 2})
        main.uploaded_data.pop("oof-shap", None); main.trained_models.pop("oof-shap", None); main.model_artifacts.pop("oof-shap", None)


if __name__ == "__main__":
    unittest.main()
