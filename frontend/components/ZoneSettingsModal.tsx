import { useCallback, useEffect, useState } from "react";
import { api, type HrZones, type UserSettings } from "../api/client";
import { setActiveZones } from "../detectWorkout";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FIELDS: Array<{ key: keyof HrZones; label: string; hint: string }> = [
  { key: "z1_max", label: "Z1 max", hint: "Top of easy / recovery" },
  { key: "z2_max", label: "Z2 max", hint: "Aerobic threshold" },
  { key: "z3_max", label: "Z3 max", hint: "Lower end of threshold work" },
  { key: "z4_max", label: "Z4 max", hint: "Lactate threshold" },
];

export default function ZoneSettingsModal({ open, onClose }: Props) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [draft, setDraft] = useState<HrZones | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDeriving, setAutoDeriving] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setDraft(s.hr_zones ?? s.effective_zones);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load settings");
    }
  }, []);

  useEffect(() => {
    if (open) {
      setErr("");
      refresh();
    }
  }, [open, refresh]);

  if (!open) return null;

  const save = async (next: HrZones | null) => {
    setSaving(true);
    setErr("");
    try {
      const res = await api.updateSettings(next);
      setSettings({ hr_zones: res.hr_zones, effective_zones: res.effective_zones });
      setDraft(res.hr_zones ?? res.effective_zones);
      setActiveZones(res.effective_zones);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleAutoDerive = async () => {
    setAutoDeriving(true);
    setErr("");
    try {
      const res = await api.autoZones();
      setDraft(res.derived_zones);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to derive zones");
    } finally {
      setAutoDeriving(false);
    }
  };

  const ascendingValid =
    draft != null &&
    draft.z1_max < draft.z2_max &&
    draft.z2_max < draft.z3_max &&
    draft.z3_max < draft.z4_max;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">HR zones</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-gray-500">
            Zone boundaries drive the intensity tags (easy/steady/tempo/threshold/vo2).
            Saving recomputes tags for all your past activities in the background.
          </p>

          {settings && !settings.hr_zones && (
            <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded px-2 py-1.5">
              Currently using auto-derived zones (no explicit value saved).
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {f.label}
                  <span className="ml-1 text-gray-400 font-normal">— {f.hint}</span>
                </label>
                <input
                  type="number"
                  min={60}
                  max={230}
                  value={draft ? draft[f.key] : ""}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, [f.key]: Number(e.target.value) } : d))
                  }
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          {!ascendingValid && draft && (
            <p className="text-red-600 text-xs">Boundaries must strictly ascend (Z1 {"<"} Z2 {"<"} Z3 {"<"} Z4).</p>
          )}
          {err && <p className="text-red-600 text-xs">{err}</p>}

          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={handleAutoDerive}
              disabled={autoDeriving}
              className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-sm disabled:opacity-50"
            >
              {autoDeriving ? "Deriving…" : "Auto-calculate from workouts"}
            </button>
            <div className="flex-1" />
            <button
              onClick={() => save(null)}
              disabled={saving}
              className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-sm disabled:opacity-50"
              title="Clears your explicit zones and falls back to auto-derive"
            >
              Reset to auto
            </button>
            <button
              onClick={() => draft && ascendingValid && save(draft)}
              disabled={saving || !ascendingValid}
              className="px-3 py-1.5 rounded bg-blue-600 text-white font-medium text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
