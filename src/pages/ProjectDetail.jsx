// src/pages/ProjectDetail.jsx
// Route: /projects/:id

import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate }           from "react-router-dom";
import { useMsal }                          from "@azure/msal-react";
import { supabase }                         from "../lib/supabase";
import { proxyUpdateProject }               from "../lib/projectProxy";

const STAGES = [
  { num: 1, label: "Bidding" },
  { num: 2, label: "Interview" },
  { num: 3, label: "Job Awarded" },
  { num: 4, label: "Job Transfer" },
  { num: 5, label: "Job Commencement" },
  { num: 6, label: "Job Closeout" },
];

const MILESTONE_VALUES = ["Yes", "No", "Missing", "N/A"];

const VALUE_STYLES = {
  Yes:     "bg-green-600 text-white",
  No:      "bg-red-600 text-white",
  Missing: "bg-yellow-500 text-gray-900",
  "N/A":   "bg-gray-600 text-gray-300",
};

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function calcCompletion(milestones) {
  if (!milestones.length) return 0;
  const done = milestones.filter((m) => m.value === "Yes" || m.value === "N/A").length;
  return Math.round((done / milestones.length) * 100);
}

function StageTracker({ currentStage, onStageChange, disabled }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Project Stage
      </h3>
      <div className="flex items-center">
        {STAGES.map((stage, idx) => {
          const active = stage.num === currentStage;
          const past   = stage.num < currentStage;
          return (
            <div key={stage.num} className="flex items-center flex-1 min-w-0">
              <button
                disabled={disabled}
                onClick={() => !disabled && onStageChange(stage.num)}
                className={[
                  "flex flex-col items-center gap-1 flex-1 min-w-0 px-1 py-2 rounded-lg transition-all",
                  active ? "bg-blue-600" : "",
                  !disabled ? "cursor-pointer hover:bg-blue-700" : "cursor-default",
                ].join(" ")}
              >
                <div className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2",
                  active ? "border-blue-300 bg-blue-500 text-white"
                         : past ? "border-gray-500 bg-gray-600 text-gray-300"
                                : "border-gray-600 bg-gray-700 text-gray-400",
                ].join(" ")}>{past ? "✓" : stage.num}</div>
                <span className={[
                  "text-xs text-center leading-tight hidden sm:block",
                  active ? "text-blue-200 font-semibold"
                         : past ? "text-gray-400" : "text-gray-500",
                ].join(" ")}>{stage.label}</span>
              </button>
              {idx < STAGES.length - 1 && (
                <div className={[
                  "h-0.5 w-3 flex-shrink-0",
                  past || active ? "bg-blue-500" : "bg-gray-700",
                ].join(" ")} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MilestonePanel({ milestones, onValueChange, saving }) {
  const pct = calcCompletion(milestones);
  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Milestones
        </h3>
        <div className="flex items-center gap-2">
          <div className="w-28 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
        </div>
      </div>
      {milestones.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">
          No milestones found for this division.
        </p>
      ) : (
        milestones.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0"
          >
            <span className="text-sm text-gray-200 flex-1 mr-4">
              {m.definition?.label ?? "—"}
            </span>
            <div className="flex gap-1">
              {MILESTONE_VALUES.map((v) => (
                <button
                  key={v}
                  disabled={saving}
                  onClick={() => onValueChange(m.id, v)}
                  className={[
                    "px-2 py-0.5 rounded text-xs font-medium transition-all",
                    m.value === v
                      ? VALUE_STYLES[v]
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600",
                    saving ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >{v}</button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function InfoGrid({ project, profiles }) {
  const name = (id) => profiles[id]?.full_name ?? "—";
  const rows = [
    ["Project #",       project.project_number],
    ["Division",        project.division],
    ["Status",          project.status],
    ["Scope",           project.scope_type],
    ["Estimator",       name(project.estimator_id)],
    ["PM",              name(project.pm_id)],
    ["Asst PM",         name(project.assistant_pm_id)],
    ["Prop Mgr/Owner",  project.property_manager_owner],
    ["Arch/Eng",        project.architect_engineer],
    ["Walkthrough",     fmt(project.walkthrough_date)],
    ["Bid Due",         fmt(project.due_date)],
    ["Bid Submitted",   project.bid_submitted ? "Yes" : "No"],
    ["Bid Amount",      project.bid_amount
                          ? `$${Number(project.bid_amount).toLocaleString()}` : "—"],
    ["Interview Date",  fmt(project.bid_interview_date)],
    ["Award Date",      fmt(project.job_award_date)],
    ["Contract Amt",    project.job_amount_contracted
                          ? `$${Number(project.job_amount_contracted).toLocaleString()}` : "—"],
  ];
  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Project Info
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-200 font-medium">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ActivityFeed({ activity, profiles }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Activity
      </h3>
      {activity.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No activity yet</p>
      ) : (
        <div className="space-y-3">
          {activity.map((a) => {
            const p      = a.author_id ? profiles[a.author_id] : null;
            const author = p ? (p.display_name ?? p.full_name) : "System";
            return (
              <div key={a.id} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-200">{a.body}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {author} · {fmt(a.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotesPanel({ notes, onSave, saving }) {
  const [draft, setDraft] = useState(notes ?? "");
  const dirty = draft !== (notes ?? "");
  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Notes
      </h3>
      <textarea
        className="w-full bg-gray-700 text-gray-200 rounded-lg p-3 text-sm resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add project notes…"
      />
      {dirty && (
        <div className="flex justify-end mt-2">
          <button
            disabled={saving}
            onClick={() => onSave(draft)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-all disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Notes"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id }                 = useParams();
  const navigate               = useNavigate();
  const { accounts, instance } = useMsal();

  const [project,    setProject]    = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [activity,   setActivity]   = useState([]);
  const [profiles,   setProfiles]   = useState({});
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const getToken = useCallback(async () => {
    const r = await instance.acquireTokenSilent({
      account: accounts[0],
      scopes:  ["User.Read"],
    });
    return r.accessToken;
  }, [accounts, instance]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: proj, error: pErr } = await supabase
          .from("projects").select("*").eq("id", id).single();
        if (pErr) throw pErr;
        setProject(proj);

        const { data: ms } = await supabase
          .from("project_milestones")
          .select(`
            id, value, milestone_def_id, updated_at,
            definition:milestone_definitions ( id, label, sort_order, key )
          `)
          .eq("project_id", id)
          .order("definition(sort_order)");
        setMilestones(ms ?? []);

        const { data: act } = await supabase
          .from("project_activity")
          .select("id, activity_type, body, created_at, author_id")
          .eq("project_id", id)
          .order("created_at", { ascending: false })
          .limit(20);
        setActivity(act ?? []);

        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, display_name");
        if (profs) setProfiles(Object.fromEntries(profs.map((p) => [p.id, p])));
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleStageChange(stage) {
    setSaving(true);
    try {
      const token   = await getToken();
      const updated = await proxyUpdateProject(id, { current_stage: stage }, token);
      setProject(updated);
      showToast(`Moved to Stage ${stage}`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  // Milestone UPDATEs go direct — rows already exist from seed, temp RLS allows it
  async function handleMilestoneChange(milestoneRowId, value) {
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("project_milestones")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("id", milestoneRowId)
        .select("id, value")
        .single();
      if (error) throw error;
      setMilestones((prev) =>
        prev.map((m) => (m.id === milestoneRowId ? { ...m, value: data.value } : m))
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveNotes(notes) {
    setSaving(true);
    try {
      const token   = await getToken();
      const updated = await proxyUpdateProject(id, { notes }, token);
      setProject(updated);
      showToast("Notes saved");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {toast && (
        <div className={[
          "fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg",
          toast.type === "error" ? "bg-red-600 text-white" : "bg-green-600 text-white",
        ].join(" ")}>{toast.msg}</div>
      )}

      <div className="flex items-start gap-4 mb-6">
        <button
          onClick={() => navigate("/projects")}
          className="text-gray-400 hover:text-white mt-1 transition-colors"
        >
          ← Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{project.project_address}</h1>
            <span className={[
              "px-2 py-0.5 rounded-full text-xs font-semibold uppercase",
              project.division === "ira"
                ? "bg-purple-700 text-purple-200"
                : "bg-blue-700 text-blue-200",
            ].join(" ")}>{project.division}</span>
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            {project.project_number && `#${project.project_number} · `}
            {project.status}
          </p>
        </div>
      </div>

      <StageTracker
        currentStage={project.current_stage ?? 1}
        onStageChange={handleStageChange}
        disabled={saving}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <InfoGrid project={project} profiles={profiles} />
          <NotesPanel notes={project.notes} onSave={handleSaveNotes} saving={saving} />
          <ActivityFeed activity={activity} profiles={profiles} />
        </div>
        <div>
          <MilestonePanel
            milestones={milestones}
            onValueChange={handleMilestoneChange}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
}
