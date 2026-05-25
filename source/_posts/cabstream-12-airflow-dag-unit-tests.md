---
title: "Unit-Testing Airflow DAGs Without Starting a Scheduler"
date: 2026-05-14 21:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

"Testing an Airflow DAG" is the kind of task most teams keep punting on, with reasons like:
- "It needs webserver + scheduler — too heavy."
- "The DAG calls GCP; I don't have local credentials."
- "Even if I test it, the only thing I can check is whether it imports."

This project uses a lightweight pattern that removes all three. CI runs it in under a second and covers every non-external code path in the DAG module.

## The key trick: stub Airflow before importing the DAG

```python
os.environ.setdefault("GCP_PROJECT_ID", "test-project")

_AIRFLOW_STUBS = [
    "airflow",
    "airflow.operators.python",
    "airflow.providers.google.cloud.transfers.local_to_gcs",
    "airflow.providers.google.cloud.operators.bigquery",
]
for name in _AIRFLOW_STUBS:
    sys.modules.setdefault(name, MagicMock())

sys.path.insert(0, str(Path(__file__).parent))
import nyc_taxi_pipeline  # noqa: E402
```

What this gives you:

- No need to `pip install apache-airflow` (fast CI)
- No GCP credentials needed (`GCP_PROJECT_ID` is any string)
- `PythonOperator` and `BigQueryInsertJobOperator` are MagicMocks, **but the callables inside the DAG are still real Python**

That lets you unit-test the actual logic of every task function.

## Three test categories that earn their keep

### Category 1: helper functions

```python
def test_year_month_valid(self):
    self.assertEqual(nyc_taxi_pipeline._year_month("2023-01"), ("2023", "01"))

def test_year_month_invalid(self):
    with self.assertRaises(ValueError):
        nyc_taxi_pipeline._year_month("2023-1")
```

`_year_month` is at the center of params validation — one bad character in the month string and the whole pipeline misfires. Pure function, cheapest tests, biggest leverage.

### Category 2: side-effecting logic (mock the network/IO)

```python
@patch("nyc_taxi_pipeline.requests.get")
def test_downloads_each_month_streamed(self, mock_get):
    chunk = b"x" * (1024 * 1024)
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_resp.iter_content.return_value = [chunk, chunk]
    mock_get.return_value.__enter__.return_value = mock_resp

    with tempfile.TemporaryDirectory() as tmp, \
         patch.object(nyc_taxi_pipeline, "DOWNLOAD_ROOT", tmp):
        result = nyc_taxi_pipeline.download_taxi_data(
            run_id="test_run",
            params={"months": ["2023-01", "2023-02"]},
        )
        self.assertEqual(mock_get.call_count, 2)
        ...
```

Two things at once:
- Request count = number of months (no skips, no duplicates)
- Files land at the right paths (tempdir replaces `DOWNLOAD_ROOT`)

**And the negative case is usually the one people skip:**

```python
def test_raises_on_tiny_file(self, mock_get):
    mock_resp.iter_content.return_value = [b"too small"]
    ...
    with self.assertRaises(RuntimeError):
        nyc_taxi_pipeline.download_taxi_data(...)
```

This exercises the "small file = failure" guard. Without a test it's effectively placeholder code.

### Category 3: configuration / static data shape

```python
def test_resource_dict_shape(self):
    r = nyc_taxi_pipeline.EXTERNAL_TABLE_RESOURCE
    self.assertEqual(r["tableReference"]["projectId"], nyc_taxi_pipeline.PROJECT_ID)
    self.assertEqual(r["externalDataConfiguration"]["sourceFormat"], "PARQUET")
    self.assertGreater(len(r["externalDataConfiguration"]["schema"]["fields"]), 0)
```

`EXTERNAL_TABLE_RESOURCE` is a hand-rolled nested dict — the kind that loves to lose a key during a copy-paste. Shape tests don't catch business bugs, but they catch the "wrong key name in a PR" class instantly.

## Bonus: trivial CI

```yaml
- run: pip install ruff pytest pandas pyarrow requests
- run: ruff check nyc_taxi_pipeline/airflow
- run: pytest nyc_taxi_pipeline/airflow
```

No `apache-airflow` in dependencies. Full config at [.github/workflows/ci.yml](.github/workflows/ci.yml).

## One-liner

> Don't try to test Airflow's scheduling behavior — that's Airflow's job. Test the pure Python that you wrote in the DAG file. Once you stub the imports, it's no different from testing any other module.

> File: [nyc_taxi_pipeline/airflow/test_dag_logic.py](nyc_taxi_pipeline/airflow/test_dag_logic.py)
