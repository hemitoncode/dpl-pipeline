"""Rule lexicon integrity + category behavior on canonical provision texts.

These snippets act as a regression suite for the lexicon: each states an
expected category for a realistic piece of statutory language. When rules
are edited, these must keep passing.
"""

from dpl_pipeline.classify import classify_provisions
from dpl_pipeline.models import CATEGORIES, Provision
from dpl_pipeline.rules import default_rules_path, load_rules


def _categories(rules, text: str) -> set[str]:
    matches = classify_provisions([Provision("P001", "", text)], rules)
    return {m.category for m in matches}


def test_lexicon_loads_and_is_valid(rules):
    assert len(rules) >= 30
    assert {r.category for r in rules} == set(CATEGORIES)
    ids = [r.rule_id for r in rules]
    assert ids == sorted(ids)  # loader guarantees sorted order


def test_lexicon_is_deterministic():
    a = load_rules(default_rules_path())
    b = load_rules(default_rules_path())
    assert [r.rule_id for r in a] == [r.rule_id for r in b]


# --- restrictive -----------------------------------------------------------

def test_strict_photo_id(rules):
    text = ("Each voter shall present valid photographic identification "
            "issued by the state before receiving a ballot. A voter who does "
            "not present such identification shall not be issued a ballot.")
    assert _categories(rules, text) == {"restrictive"}


def test_proof_of_citizenship(rules):
    text = ("An applicant shall provide documentary proof of United States "
            "citizenship at the time of registration.")
    assert _categories(rules, text) == {"restrictive"}


def test_purge_for_not_voting(rules):
    text = ("The county clerk shall cancel the registration of any elector "
            "who has failed to vote in two consecutive general elections and "
            "failed to respond to a confirmation notice.")
    assert _categories(rules, text) == {"restrictive"}


def test_ballot_collection_ban(rules):
    text = ("It is unlawful for any person to knowingly collect or deliver "
            "another person's voted or unvoted absentee ballot, except for a "
            "family member or household member.")
    assert "restrictive" in _categories(rules, text)


def test_witness_requirement(rules):
    text = ("The statement on the return envelope of an absentee ballot "
            "shall be witnessed by two adults or notarized.")
    assert "restrictive" in _categories(rules, text)


# --- expansive -------------------------------------------------------------

def test_automatic_registration(rules):
    text = ("The department of motor vehicles shall automatically register "
            "to vote each eligible applicant unless the applicant declines.")
    assert _categories(rules, text) == {"expansive"}


def test_same_day_registration(rules):
    text = ("A qualified elector may complete same-day voter registration at "
            "the polling place and cast a ballot in that election.")
    assert _categories(rules, text) == {"expansive"}


def test_same_day_registration_repeal_is_restrictive(rules):
    text = ("The provisions authorizing same-day voter registration are "
            "repealed effective January 1.")
    assert _categories(rules, text) == {"restrictive"}


def test_rights_restoration(rules):
    text = ("A person convicted of a felony shall have the right to vote "
            "restored upon release from incarceration.")
    assert _categories(rules, text) == {"expansive"}


def test_cure_process(rules):
    text = ("The registrar shall notify the voter of any signature "
            "deficiency and provide an opportunity to cure the defect on the "
            "absentee ballot envelope no later than noon on the third day.")
    assert "expansive" in _categories(rules, text)


def test_drop_box_expansion(rules):
    text = ("The governing body shall establish at least one drop box for "
            "the return of marked absentee ballots in each county.")
    assert _categories(rules, text) == {"expansive"}


def test_drop_box_limit_is_restrictive(rules):
    text = ("A county shall provide no more than one drop box regardless of "
            "population, and drop boxes shall be located only at the office "
            "of the county clerk.")
    assert "restrictive" in _categories(rules, text)


# --- election interference -------------------------------------------------

def test_criminal_penalties_on_officials(rules):
    text = ("Any election official who sends an absentee ballot application "
            "to a voter who has not requested one is guilty of a felony of "
            "the third degree.")
    assert "election_interference" in _categories(rules, text)


def test_protecting_officials_is_not_interference(rules):
    text = ("Any person who threatens or intimidates an election official or "
            "election worker in the performance of official duties is guilty "
            "of a felony.")
    assert "election_interference" not in _categories(rules, text)


def test_partisan_takeover(rules):
    text = ("The State Election Board may suspend and remove a county "
            "election superintendent and appoint an individual to assume "
            "control of county election administration.")
    assert "election_interference" in _categories(rules, text)


def test_certification_interference(rules):
    text = ("The board of canvassers may decline to certify the results of "
            "an election pending an investigation of alleged irregularities.")
    assert "election_interference" in _categories(rules, text)


def test_risk_limiting_audit_not_interference(rules):
    text = ("The secretary of state shall conduct a risk-limiting audit of "
            "at least one statewide contest after each general election.")
    assert "election_interference" not in _categories(rules, text)


# --- neutral ---------------------------------------------------------------

def test_unrelated_bill_is_neutral(rules):
    text = ("The segment of State Route 12 between mile marker 4 and mile "
            "marker 9 is hereby designated the Veterans Memorial Highway. "
            "The department shall erect suitable markers.")
    assert _categories(rules, text) == set()


def test_technical_election_cleanup_is_neutral(rules):
    text = ("The term 'general registrar' is substituted for 'registrar' "
            "throughout Title 24.2 to conform terminology; no substantive "
            "change is intended.")
    assert _categories(rules, text) == set()
