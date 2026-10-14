from pathlib import Path
p=Path('scripts/browser_demo_polish.mjs');s=p.read_text();old="    await page.emulateMedia({ reducedMotion: 'reduce' });\n    await page.locator('#query-text').fill('Local marker');";new="    await page.emulateMedia({ reducedMotion: 'reduce' });\n    await page.locator('#graph-view').selectOption('evidence');\n    await page.locator('#query-text').fill('Local marker');";assert old in s;p.write_text(s.replace(old,new))
p=Path('scripts/browser_rag_smoke.mjs');s=p.read_text().replace('failure = error instanceof Error ? error.message : String(error);','failure = error instanceof Error ? error.stack ?? error.message : String(error);');p.write_text(s)
p=Path('scripts/browser_rag_smoke.py');s=p.read_text();old='''    _validate_driver_report(path, require_server_cleanup=False)
    if lifecycle != {"vite_process_tree_terminated": True, "port_released": True}:
        raise RuntimeError("browser-rag-ts server lifecycle proof is incomplete")
    report = _read_object(path)
    termination = _object(report["termination"], "browser smoke termination")''';new='''    if lifecycle != {"vite_process_tree_terminated": True, "port_released": True}:
        raise RuntimeError("browser-rag-ts server lifecycle proof is incomplete")
    report = _read_object(path)
    if report.get("schema") != "browser-rag-ts-smoke-v10" or report.get("status") not in ("pass", "fail"):
        raise RuntimeError("browser smoke cleanup received an invalid report envelope")
    termination = _exact(report.get("termination"), TERMINATION_KEYS, "browser smoke termination")
    if any(type(value) is not bool for value in termination.values()):
        raise RuntimeError("browser smoke termination values must be boolean")
    if report["status"] == "pass":
        _validate_driver_report(path, require_server_cleanup=False)
    # A functional failure must retain truthful cleanup without becoming a pass.''';assert old in s;s=s.replace(old,new)
s=s.replace('                    _validate_driver_report(output)\n','                    if result == 0:\n                        _validate_driver_report(output)\n');p.write_text(s)
p=Path('source/backend/tests/test_browser_rag_runner.py');s=p.read_text();old='class BrowserRagRunnerTests(unittest.TestCase):';new='''class BrowserRagRunnerTests(unittest.TestCase):
    def test_failed_journey_records_cleanup_without_claiming_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "failed.json"
            payload = {"schema": "browser-rag-ts-smoke-v10", "status": "fail", "failure": "injected check failure",
                       "termination": {key: False for key in SMOKE.TERMINATION_KEYS}}
            path.write_text(json.dumps(payload), encoding="utf-8")
            SMOKE._record_server_cleanup(path, {"vite_process_tree_terminated": True, "port_released": True})
            recorded = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(recorded["status"], "fail")
            self.assertEqual(recorded["failure"], "injected check failure")
            self.assertTrue(recorded["termination"]["port_released"])
            self.assertTrue(recorded["termination"]["vite_process_tree_terminated"])
            self.assertFalse(recorded["termination"]["worker_disposal_acknowledged"])
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(path)
            before = path.read_bytes()
            with self.assertRaises(RuntimeError):
                SMOKE._record_server_cleanup(path, {"vite_process_tree_terminated": True, "port_released": False})
            self.assertEqual(path.read_bytes(), before)

''';assert old in s;p.write_text(s.replace(old,new))
