from pathlib import Path
p=Path('scripts/browser_demo_polish.mjs');s=p.read_text()
s=s.replace('window.polish.graph = event.data.result.nodes.map((node) => node.record_id);','window.polish.graph = event.data.result.nodes.map(({ id, kind, record_id, source_id }) => ({ id, kind, record_id, source_id }));')
old="        if (!state.context || state.context.chunks.some(({ id }) => !state.graph.includes(id))) state.violations.push('trace before matching graph');"
new="""        // The vault view represents chunks through their actual source nodes.
        // Check both the Worker projection and the currently rendered identities.
        const rendered = [...document.querySelectorAll('#graph-canvas circle[data-graph-node-id]')].map(node => ({
          kind: node.dataset.kind, record_id: node.dataset.recordId, source_id: node.dataset.sourceId
        }));
        const represents = (nodes, chunk) => nodes.some(node => node.record_id === chunk.id ||
          (node.kind === 'source' && node.source_id === chunk.source_id));
        const missing = state.context?.chunks.filter(chunk => !represents(state.graph, chunk) || !represents(rendered, chunk));
        if (!state.context || missing.length) state.violations.push({ issue: 'trace before matching graph',
          view: document.querySelector('#graph-view')?.value, missing: missing?.map(chunk => chunk.id) });"""
assert old in s;s=s.replace(old,new);p.write_text(s)
p=Path('scripts/local_runtime.py');s=p.read_text();old='''        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", port))
        return True''';new='''        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            if os.name == "nt":
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                # Match normal server rebinding after closed TCP connections.
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))
            # Reuse must never mistake another active listener for a free port.
            listener.listen(1)
        return True''';assert old in s;p.write_text(s.replace(old,new))
p=Path('source/backend/tests/test_browser_rag_runner.py');s=p.read_text().replace('import json\n','import json\nimport os\nimport socket\n')
s=s.replace('SMOKE = _load("browser_rag_smoke")','SMOKE = _load("browser_rag_smoke")\nimport local_runtime as LOCAL_RUNTIME')
old='class BrowserRagRunnerTests(unittest.TestCase):';new='''class BrowserRagRunnerTests(unittest.TestCase):
    def test_real_listener_is_never_admitted_as_available(self) -> None:
        with socket.socket() as listener:
            if os.name != "nt":
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            self.assertFalse(LOCAL_RUNTIME.port_available(port))
            self.assertFalse(LOCAL_RUNTIME.wait_port_release(port, .02))
        self.assertTrue(LOCAL_RUNTIME.wait_port_release(port))

    @unittest.skipIf(os.name == "nt", "POSIX TIME_WAIT rebinding semantics")
    def test_closed_connection_allows_a_real_replacement_listener(self) -> None:
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            listener.settimeout(2)
            port = listener.getsockname()[1]
            with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(2)
                    connection.shutdown(socket.SHUT_WR)
                    self.assertEqual(client.recv(1), b"")
                    client.shutdown(socket.SHUT_WR)
                    self.assertEqual(connection.recv(1), b"")
            self.assertFalse(LOCAL_RUNTIME.port_available(port))
        self.assertTrue(LOCAL_RUNTIME.wait_port_release(port))
        with socket.create_server(("127.0.0.1", port)) as replacement:
            self.assertFalse(LOCAL_RUNTIME.port_available(port))

''';assert old in s;p.write_text(s.replace(old,new))
p=Path('.github/workflows/dependency-review.yml');s=p.read_text();s=s.replace('          node run.mjs test-method','          python -B -m unittest discover -s source/backend/tests -p test_browser_rag_runner.py -v\n          node run.mjs test-method');p.write_text(s)
