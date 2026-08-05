import sys
from pathlib import Path

import pytest

# Allow running tests without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dpl_pipeline.rules import default_rules_path, load_rules  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def rules():
    return load_rules(default_rules_path())
