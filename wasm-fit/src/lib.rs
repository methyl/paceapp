use fitparser::{from_bytes, profile::MesgNum, FitDataField, Value};
use js_sys::{Array, Date, Object, Reflect};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

const SEMICIRCLE_TO_DEG: f64 = 180.0 / (1u64 << 31) as f64;

// ─── Helpers: name conversion + value coercion ─────────────────────────────

/// snake_case → camelCase. `total_distance` → `totalDistance`.
fn snake_to_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut upper_next = false;
    for ch in s.chars() {
        if ch == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(ch.to_uppercase());
            upper_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

/// FIT enum values come out of fitparser as snake_case strings (e.g.
/// `activity_end`, `stop_all`). The @garmin/fitsdk Decoder camelCases them
/// (`activityEnd`, `stopAll`) and the matching Encoder expects the same
/// shape, so any string composed only of `[a-z0-9_]` with at least one
/// underscore is treated as an enum and camelCased. Real string fields
/// (manufacturer names, device names, etc.) typically contain spaces or
/// uppercase letters, so they pass through unchanged.
fn maybe_camelize_enum(s: &str) -> String {
    let snake_like = !s.is_empty()
        && s.contains('_')
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if snake_like { snake_to_camel(s) } else { s.to_string() }
}

fn as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::SInt8(x) => Some(*x as f64),
        Value::UInt8(x) => Some(*x as f64),
        Value::UInt8z(x) => Some(*x as f64),
        Value::SInt16(x) => Some(*x as f64),
        Value::UInt16(x) => Some(*x as f64),
        Value::UInt16z(x) => Some(*x as f64),
        Value::SInt32(x) => Some(*x as f64),
        Value::UInt32(x) => Some(*x as f64),
        Value::UInt32z(x) => Some(*x as f64),
        Value::SInt64(x) => Some(*x as f64),
        Value::UInt64(x) => Some(*x as f64),
        Value::UInt64z(x) => Some(*x as f64),
        Value::Float32(x) => Some(*x as f64),
        Value::Float64(x) => Some(*x),
        Value::Byte(x) => Some(*x as f64),
        Value::Enum(x) => Some(*x as f64),
        _ => None,
    }
}

fn as_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// Convert a fitparser Value to a JS value matching @garmin/fitsdk's
/// Decoder output convention (Date for timestamps, numbers for numeric
/// types, camelCase strings for enums, JS Arrays for repeating fields).
fn value_to_js(v: &Value) -> JsValue {
    match v {
        Value::Timestamp(t) => Date::new(&JsValue::from_f64(t.timestamp_millis() as f64)).into(),
        Value::String(s) => JsValue::from_str(&maybe_camelize_enum(s)),
        Value::Array(arr) => {
            let out = Array::new_with_length(arr.len() as u32);
            for (i, v) in arr.iter().enumerate() {
                out.set(i as u32, value_to_js(v));
            }
            out.into()
        }
        Value::SInt8(x) => JsValue::from_f64(*x as f64),
        Value::UInt8(x) => JsValue::from_f64(*x as f64),
        Value::UInt8z(x) => JsValue::from_f64(*x as f64),
        Value::SInt16(x) => JsValue::from_f64(*x as f64),
        Value::UInt16(x) => JsValue::from_f64(*x as f64),
        Value::UInt16z(x) => JsValue::from_f64(*x as f64),
        Value::SInt32(x) => JsValue::from_f64(*x as f64),
        Value::UInt32(x) => JsValue::from_f64(*x as f64),
        Value::UInt32z(x) => JsValue::from_f64(*x as f64),
        Value::SInt64(x) => JsValue::from_f64(*x as f64),
        Value::UInt64(x) => JsValue::from_f64(*x as f64),
        Value::UInt64z(x) => JsValue::from_f64(*x as f64),
        Value::Float32(x) => JsValue::from_f64(*x as f64),
        Value::Float64(x) => JsValue::from_f64(*x),
        Value::Byte(x) => JsValue::from_f64(*x as f64),
        Value::Enum(x) => JsValue::from_f64(*x as f64),
        _ => JsValue::null(),
    }
}

// ─── "Parsed" structured output for parseFit.ts ────────────────────────────

/// Set an optional numeric field on a JS object only if Some(_).
fn set_opt_num(obj: &Object, key: &str, val: Option<f64>) {
    if let Some(v) = val {
        let _ = Reflect::set(obj, &JsValue::from_str(key), &JsValue::from_f64(v));
    }
}

fn set_opt_str(obj: &Object, key: &str, val: Option<String>) {
    if let Some(v) = val {
        let _ = Reflect::set(obj, &JsValue::from_str(key), &JsValue::from_str(&v));
    }
}

fn set_opt_iso(obj: &Object, key: &str, t: Option<&chrono::DateTime<chrono::Local>>) {
    if let Some(t) = t {
        let s = t
            .to_utc()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let _ = Reflect::set(obj, &JsValue::from_str(key), &JsValue::from_str(&s));
    }
}

fn semicircles_to_deg(v: &Value) -> Option<f64> {
    as_f64(v).map(|x| x * SEMICIRCLE_TO_DEG)
}

/// Build the structured "session" object consumed by parseFit.ts.
fn build_session(fields: &[FitDataField]) -> Object {
    let obj = Object::new();
    for f in fields {
        let v = f.value();
        match f.name() {
            "start_time" => {
                if let Value::Timestamp(t) = v {
                    set_opt_iso(&obj, "start_time", Some(t));
                }
            }
            "total_distance" => set_opt_num(&obj, "total_distance", as_f64(v)),
            "total_timer_time" => set_opt_num(&obj, "total_timer_time", as_f64(v)),
            "total_elapsed_time" => set_opt_num(&obj, "total_elapsed_time", as_f64(v)),
            "avg_heart_rate" => set_opt_num(&obj, "avg_heart_rate", as_f64(v)),
            "max_heart_rate" => set_opt_num(&obj, "max_heart_rate", as_f64(v)),
            "avg_cadence" => set_opt_num(&obj, "avg_cadence", as_f64(v)),
            "avg_running_cadence" => {
                // fitparser separates avg_cadence (uint8) and avg_running_cadence
                // (strides/min). Use whichever is present; record-level cadence
                // already gets ×2 in the JS layer.
                set_opt_num(&obj, "avg_cadence", as_f64(v));
            }
            "avg_speed" => set_opt_num(&obj, "avg_speed", as_f64(v)),
            "enhanced_avg_speed" => set_opt_num(&obj, "enhanced_avg_speed", as_f64(v)),
            "sport" => set_opt_str(&obj, "sport", as_string(v)),
            "avg_vertical_oscillation" => set_opt_num(&obj, "avg_vertical_oscillation", as_f64(v)),
            "avg_stance_time" => set_opt_num(&obj, "avg_stance_time", as_f64(v)),
            "avg_step_length" => set_opt_num(&obj, "avg_step_length", as_f64(v)),
            "avg_vertical_ratio" => set_opt_num(&obj, "avg_vertical_ratio", as_f64(v)),
            "avg_power" => set_opt_num(&obj, "avg_power", as_f64(v)),
            _ => {}
        }
    }
    obj
}

fn build_lap(fields: &[FitDataField]) -> (Object, Option<i64>) {
    let obj = Object::new();
    let mut start_ms: Option<i64> = None;
    for f in fields {
        let v = f.value();
        match f.name() {
            "start_time" => {
                if let Value::Timestamp(t) = v {
                    start_ms = Some(t.timestamp_millis());
                    set_opt_iso(&obj, "start_time", Some(t));
                }
            }
            "total_distance" => set_opt_num(&obj, "total_distance", as_f64(v)),
            "total_timer_time" => set_opt_num(&obj, "total_timer_time", as_f64(v)),
            "total_elapsed_time" => set_opt_num(&obj, "total_elapsed_time", as_f64(v)),
            "avg_speed" => set_opt_num(&obj, "avg_speed", as_f64(v)),
            "enhanced_avg_speed" => set_opt_num(&obj, "enhanced_avg_speed", as_f64(v)),
            "avg_heart_rate" => set_opt_num(&obj, "avg_heart_rate", as_f64(v)),
            "max_heart_rate" => set_opt_num(&obj, "max_heart_rate", as_f64(v)),
            "avg_cadence" | "avg_running_cadence" => set_opt_num(&obj, "avg_cadence", as_f64(v)),
            "avg_vertical_oscillation" => set_opt_num(&obj, "avg_vertical_oscillation", as_f64(v)),
            "avg_stance_time" => set_opt_num(&obj, "avg_stance_time", as_f64(v)),
            "avg_stance_time_balance" => set_opt_num(&obj, "avg_stance_time_balance", as_f64(v)),
            "avg_step_length" => set_opt_num(&obj, "avg_step_length", as_f64(v)),
            "avg_vertical_ratio" => set_opt_num(&obj, "avg_vertical_ratio", as_f64(v)),
            "avg_power" => set_opt_num(&obj, "avg_power", as_f64(v)),
            _ => {}
        }
    }
    (obj, start_ms)
}

fn build_record(fields: &[FitDataField]) -> (Object, Option<i64>) {
    let obj = Object::new();
    let mut ts_ms: Option<i64> = None;
    // Default distance to 0 — parseFit.ts treats missing distance as 0.
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("distance"),
        &JsValue::from_f64(0.0),
    );
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("elapsed_time"),
        &JsValue::from_f64(0.0),
    );
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("lap_index"),
        &JsValue::from_f64(0.0),
    );
    for f in fields {
        let v = f.value();
        match f.name() {
            "timestamp" => {
                if let Value::Timestamp(t) = v {
                    ts_ms = Some(t.timestamp_millis());
                    set_opt_iso(&obj, "timestamp", Some(t));
                }
            }
            "distance" => set_opt_num(&obj, "distance", as_f64(v)),
            "position_lat" => set_opt_num(&obj, "position_lat", semicircles_to_deg(v)),
            "position_long" => set_opt_num(&obj, "position_long", semicircles_to_deg(v)),
            "altitude" => set_opt_num(&obj, "altitude", as_f64(v)),
            "enhanced_altitude" => set_opt_num(&obj, "enhanced_altitude", as_f64(v)),
            "heart_rate" => set_opt_num(&obj, "heart_rate", as_f64(v)),
            "cadence" => set_opt_num(&obj, "cadence", as_f64(v)),
            "speed" => set_opt_num(&obj, "speed", as_f64(v)),
            "enhanced_speed" => set_opt_num(&obj, "enhanced_speed", as_f64(v)),
            "vertical_oscillation" => set_opt_num(&obj, "vertical_oscillation", as_f64(v)),
            "stance_time" => set_opt_num(&obj, "stance_time", as_f64(v)),
            "stance_time_balance" => set_opt_num(&obj, "stance_time_balance", as_f64(v)),
            "step_length" => set_opt_num(&obj, "step_length", as_f64(v)),
            "vertical_ratio" => set_opt_num(&obj, "vertical_ratio", as_f64(v)),
            "power" => set_opt_num(&obj, "power", as_f64(v)),
            _ => {}
        }
    }
    (obj, ts_ms)
}

// ─── "Raw" SDK Encoder-compatible mirror of every message ──────────────────

/// FIT epoch is 1989-12-31 00:00:00 UTC = 631065600 Unix seconds. Some
/// fields (notably `activity.local_timestamp`) are typed `local_date_time`
/// in the FIT profile and the @garmin/fitsdk Decoder leaves them as raw
/// uint32 (FIT seconds), not Date objects. The Encoder expects the same.
const FIT_EPOCH_UNIX_SECONDS: i64 = 631_065_600;

/// Conventional FIT field names that are typed `local_date_time` rather
/// than `date_time`, so their JS representation is a number (FIT seconds)
/// not a Date. Only `activity.local_timestamp` is in our exported subset.
fn is_local_date_time_field(name: &str) -> bool {
    matches!(name, "local_timestamp")
}

/// True if `name` is a valid FIT profile field name (snake_case ASCII).
/// Developer fields can have arbitrary names with spaces and uppercase
/// letters — we skip those because @garmin/fitsdk Decoder buckets them
/// into a separate `developerFields` object and the Encoder ignores them.
fn is_profile_field_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// FIT field aliases populated by the @garmin/fitsdk Decoder via the
/// profile's subField/component mechanism. For example, when a file only
/// stores `enhanced_avg_speed` (uint32 mm/s for high-precision speeds),
/// the SDK back-fills the canonical `avg_speed` (uint16 m/s) at the same
/// numeric value so consumers don't need to know which encoding was used.
/// Apple Watch and modern Garmins store the enhanced/running variants;
/// without these aliases, lap/session messages decoded by our WASM are
/// missing the canonical fields, and the encoder produces FIT files that
/// don't match the original on round-trip.
const ALIASES: &[(&str, &str)] = &[
    ("enhanced_avg_speed", "avg_speed"),
    ("enhanced_max_speed", "max_speed"),
    ("enhanced_avg_altitude", "avg_altitude"),
    ("enhanced_min_altitude", "min_altitude"),
    ("enhanced_max_altitude", "max_altitude"),
    ("avg_running_cadence", "avg_cadence"),
    ("max_running_cadence", "max_cadence"),
    ("total_strides", "total_cycles"),
];

/// Build the @garmin/fitsdk-style camelCase mirror of a single message.
/// Field names are camelCased; later occurrences of the same field name
/// overwrite earlier ones (fitparser emits expanded components AFTER the
/// raw field, and we want the final value).
fn build_raw_mesg(fields: &[FitDataField]) -> Object {
    let obj = Object::new();
    let mut seen = std::collections::HashSet::new();
    for f in fields {
        let name = f.name();
        if !is_profile_field_name(name) {
            continue;
        }
        // local_date_time fields encode as FIT seconds (number), not Date.
        let value = if is_local_date_time_field(name) {
            if let Value::Timestamp(t) = f.value() {
                JsValue::from_f64((t.timestamp() - FIT_EPOCH_UNIX_SECONDS) as f64)
            } else {
                value_to_js(f.value())
            }
        } else {
            value_to_js(f.value())
        };
        let camel = snake_to_camel(name);
        let _ = Reflect::set(&obj, &JsValue::from_str(&camel), &value);
        seen.insert(name.to_string());
    }
    // Mirror enhanced/running variants to their canonical SDK aliases.
    for (alt, canon) in ALIASES {
        if seen.contains(*alt) && !seen.contains(*canon) {
            let alt_camel = snake_to_camel(alt);
            let canon_camel = snake_to_camel(canon);
            let v = Reflect::get(&obj, &JsValue::from_str(&alt_camel)).unwrap_or(JsValue::UNDEFINED);
            if !v.is_undefined() {
                let _ = Reflect::set(&obj, &JsValue::from_str(&canon_camel), &v);
            }
        }
    }
    obj
}

/// Map the snake_case mesg name (from MesgNum's Display) to the
/// `<camelCase>Mesgs` key used by @garmin/fitsdk Decoder output.
fn raw_mesg_key(kind: &MesgNum) -> String {
    let snake = format!("{}", kind);
    let camel = snake_to_camel(&snake);
    format!("{}Mesgs", camel)
}

// ─── Entry point ───────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn parse_fit(data: &[u8]) -> Result<JsValue, JsValue> {
    #[cfg(feature = "panic-hook")]
    console_error_panic_hook::set_once();

    let recs = from_bytes(data).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut session: Option<Object> = None;
    let mut laps: Vec<Object> = Vec::new();
    let mut lap_starts_ms: Vec<i64> = Vec::new();
    let mut records: Vec<Object> = Vec::new();
    let mut record_ts_ms: Vec<i64> = Vec::new();

    let mut raw: HashMap<String, Array> = HashMap::new();

    for rec in &recs {
        let kind = rec.kind();
        let fields = rec.fields();

        // Mirror to raw[*Mesgs] for export — but NOT recordMesgs. Records
        // dominate FIT files (~5000 per activity) and exportFit.ts doesn't
        // read raw.recordMesgs; it iterates activity.records directly. Skipping
        // the raw record mirror is a ~5x cost reduction on parse.
        if !matches!(kind, MesgNum::Record) {
            let raw_obj = build_raw_mesg(fields);
            raw.entry(raw_mesg_key(&kind))
                .or_insert_with(Array::new)
                .push(&raw_obj);
        }

        // Extract structured data for the parser pipeline.
        match kind {
            MesgNum::Session if session.is_none() => {
                session = Some(build_session(fields));
            }
            MesgNum::Lap => {
                let (lap, start_ms) = build_lap(fields);
                lap_starts_ms.push(start_ms.unwrap_or(i64::MIN));
                laps.push(lap);
            }
            MesgNum::Record => {
                let (r, ts) = build_record(fields);
                record_ts_ms.push(ts.unwrap_or(i64::MIN));
                records.push(r);
            }
            _ => {}
        }
    }

    // Compute elapsed_time relative to the first record (FIT files emit the
    // session message at the end, so its start_time isn't available during
    // record parsing — and "elapsed since first record" is the convention
    // fit-file-parser used anyway).
    let first_record_ts = record_ts_ms.iter().copied().find(|&t| t != i64::MIN);
    if let Some(start) = first_record_ts {
        for (r, &ts) in records.iter_mut().zip(record_ts_ms.iter()) {
            if ts != i64::MIN {
                let _ = Reflect::set(
                    r,
                    &JsValue::from_str("elapsed_time"),
                    &JsValue::from_f64(((ts - start) as f64) / 1000.0),
                );
            }
        }
    }

    // FIT files often emit lap messages after the records they cover, but we
    // still want lap_index in chronological order. Permute laps by start_time
    // and assign each record to the largest lap-start <= its timestamp.
    let n_laps = laps.len();
    let mut perm: Vec<usize> = (0..n_laps).collect();
    perm.sort_by_key(|&i| lap_starts_ms[i]);

    let chrono_laps_arr = Array::new_with_length(n_laps as u32);
    let mut sorted_starts: Vec<i64> = Vec::with_capacity(n_laps);
    for (chrono_i, &doc_i) in perm.iter().enumerate() {
        sorted_starts.push(lap_starts_ms[doc_i]);
        chrono_laps_arr.set(chrono_i as u32, JsValue::from(laps[doc_i].clone()));
    }

    let records_arr = Array::new_with_length(records.len() as u32);
    if !sorted_starts.is_empty() {
        for (i, (r, &ts)) in records.iter().zip(record_ts_ms.iter()).enumerate() {
            let pos = match sorted_starts.binary_search(&ts) {
                Ok(j) => j,
                Err(0) => 0,
                Err(j) => j - 1,
            };
            let _ = Reflect::set(
                r,
                &JsValue::from_str("lap_index"),
                &JsValue::from_f64(pos as f64),
            );
            records_arr.set(i as u32, JsValue::from(r.clone()));
        }
    } else {
        for (i, r) in records.iter().enumerate() {
            records_arr.set(i as u32, JsValue::from(r.clone()));
        }
    }

    let raw_obj = Object::new();
    for (k, arr) in raw {
        let _ = Reflect::set(&raw_obj, &JsValue::from_str(&k), &arr);
    }

    let result = Object::new();
    let _ = Reflect::set(
        &result,
        &JsValue::from_str("session"),
        &session.map(JsValue::from).unwrap_or(JsValue::NULL),
    );
    let _ = Reflect::set(&result, &JsValue::from_str("laps"), &chrono_laps_arr);
    let _ = Reflect::set(&result, &JsValue::from_str("records"), &records_arr);
    let _ = Reflect::set(&result, &JsValue::from_str("rawMessages"), &raw_obj);

    Ok(result.into())
}
