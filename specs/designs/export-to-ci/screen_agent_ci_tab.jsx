function CITab() {
  const [repos, setRepos] = React.useState([
    ["acme/payments-api", "GitHub Actions", "succeeded", "4m ago"],
    ["acme/billing-worker", "GitHub Actions", "succeeded", "1h ago"],
  ]);
  const [wizard, setWizard] = React.useState(false);
  const [failOn, setFailOn] = React.useState("critical");
  const exported = repos.length > 0;
  const FAIL_OPTS = [["critical", "Critical"], ["warning", "Warning +"], ["never", "Never"]];
  return React.createElement("div", { style: { maxWidth: 720 } },
    wizard && window.ExportWizard && React.createElement(window.ExportWizard, { onClose: () => setWizard(false) }),
    !exported
      ? React.createElement("div", { style: { maxWidth: 600, textAlign: "center", padding: "40px 0" } },
          React.createElement(window.EmptyState, { icon: "Workflow", title: "Not in CI yet", body: "Deploy this agent to run automatically on every pull request in a repo's CI pipeline.", cta: "Add to CI", onCta: () => setWizard(true) }))
      : React.createElement(React.Fragment, null,
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 } },
            React.createElement("h2", { style: { fontSize: 16, fontWeight: 700 } }, "CI deployment"),
            React.createElement(window.Badge, { color: "var(--ok)", bg: "var(--ok-bg)", dot: true }, "Active in " + repos.length + " repos"),
            React.createElement("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
              React.createElement(window.Button, { kind: "secondary", size: "sm", icon: "RefreshCw" }, "Update CI config"),
              React.createElement(window.Button, { kind: "primary", size: "sm", icon: "Plus", onClick: () => setWizard(true) }, "Add to CI"))),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", marginBottom: 16 } },
            React.createElement("div", { style: { minWidth: 0, flex: 1 } },
              React.createElement("div", { style: { fontSize: 13, fontWeight: 600 } }, "Fail CI on"),
              React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 } }, "Exit non-zero when a finding at or above this severity lands. Pair with a required status check to block merges.")),
            React.createElement("div", { style: { display: "flex", gap: 2, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 7, padding: 2, flexShrink: 0 } },
              FAIL_OPTS.map(([k, label]) => React.createElement("button", { key: k, onClick: () => setFailOn(k),
                style: { padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 5, border: "none", cursor: "pointer",
                  background: failOn === k ? "var(--bg-elevated)" : "transparent", color: failOn === k ? "var(--text-primary)" : "var(--text-muted)" } }, label)))),
          repos.map((r, i) =>
            React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", marginBottom: 8 } },
              React.createElement(window.Icon.GitBranch, { size: 16, style: { color: "var(--text-muted)" } }),
              React.createElement("span", { className: "mono", style: { fontSize: 13, fontWeight: 600, flex: 1 } }, r[0]),
              React.createElement(window.Badge, { color: "var(--text-secondary)", icon: "Workflow" }, r[1]),
              React.createElement(window.Badge, { color: "var(--ok)", bg: "var(--ok-bg)", dot: true }, r[2]),
              React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-muted)" } }, r[3]))),
          React.createElement("button", { onClick: () => setWizard(true),
            style: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 2 } },
            React.createElement(window.Icon.Plus, { size: 15 }), "Add repository")));
}

function EvalMetricStrip() {
  const E = window.EVAL;
  const items = [
    ["Recall", E.current.recall, E.delta.recall, "var(--accent)"],
    ["Precision", E.current.precision, E.delta.precision, "var(--ok)"],
    ["Citation accuracy", E.current.citation, E.delta.citation, "var(--warn)"],
    ["Traces passed", E.current.traces_passed / E.current.traces_total, null, "var(--text-secondary)"],
  ];
  return React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 18 } },
    items.map(([l, v, d, c], i) => React.createElement("div", { key: i, style: { flex: 1, padding: "11px 13px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-elevated)" } },
      React.createElement("div", { style: { fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 } }, l),
      React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 7 } },
        React.createElement("span", { className: "tnum", style: { fontSize: 22, fontWeight: 700, color: c } },
          l === "Traces passed" ? E.current.traces_passed + "/" + E.current.traces_total : Math.round(v * 100) + "%"),
