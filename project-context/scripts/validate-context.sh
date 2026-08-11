#!/usr/bin/env bash
set -euo pipefail

context_dir="$(cd "$(dirname "$0")/.." && pwd)"

ruby - "$context_dir" <<'RUBY'
require "yaml"
require "json"
require "csv"
require "digest"
require "open3"
require "pathname"

root = Pathname.new(ARGV.fetch(0)).realpath
errors = []
warnings = []

def load_yaml(path, errors)
  YAML.safe_load(File.read(path), aliases: true)
rescue StandardError => e
  errors << "#{path}: YAML parse failed: #{e.message}"
  {}
end

# Sufficient for these ASCII/integer golden fixtures. Production code must use
# a tested RFC 8785 implementation rather than treating this helper as generic JCS.
def canonical_fixture_json(value)
  case value
  when Hash
    value.keys.sort.each_with_object({}) { |key, out| out[key] = canonical_fixture_json(value[key]) }
  when Array
    value.map { |item| canonical_fixture_json(item) }
  else
    value
  end
end

def fixture_hash(value)
  "sha256:#{Digest::SHA256.hexdigest(JSON.generate(canonical_fixture_json(value)))}"
end

manifest_path = root.join("MANIFEST.yaml")
state_path = root.join("CURRENT_STATE.yaml")
gates_path = root.join("GATES.yaml")
manifest = load_yaml(manifest_path, errors)
state = load_yaml(state_path, errors)
gates = load_yaml(gates_path, errors)
repository_root = root.parent

def git_result(repository_root, *arguments)
  output, status = Open3.capture2e("git", "-C", repository_root.to_s, *arguments)
  [output.strip, status.success?]
end

recorded_repository = state["repository"] || {}
recorded_branch = recorded_repository["branch"]
actual_branch, branch_known = git_result(repository_root, "symbolic-ref", "--short", "-q", "HEAD")
if branch_known
  errors << "CURRENT_STATE repository branch #{recorded_branch.inspect} differs from checked-out branch #{actual_branch.inspect}" unless recorded_branch == actual_branch
else
  warnings << "Git checkout is detached; CURRENT_STATE branch could not be compared"
end

%w[base_commit planning_base_commit planning_handoff_commit verified_implementation_commit last_good_commit].each do |field|
  commit = recorded_repository[field]
  next if commit.nil?
  unless commit.is_a?(String) && commit.match?(/\A[0-9a-f]{7,40}\z/)
    errors << "CURRENT_STATE repository.#{field} is not a Git commit hash"
    next
  end
  _output, exists = git_result(repository_root, "cat-file", "-e", "#{commit}^{commit}")
  unless exists
    errors << "CURRENT_STATE repository.#{field} does not exist in this checkout: #{commit}"
    next
  end
  _output, ancestor = git_result(repository_root, "merge-base", "--is-ancestor", commit, "HEAD")
  errors << "CURRENT_STATE repository.#{field} is not an ancestor of HEAD: #{commit}" unless ancestor
end

active_task_ids = Array(state["active_ownership"]).map { |entry| entry["task_id"] }.compact
current_task = state["current_task"]
if active_task_ids.any? && !active_task_ids.include?(current_task)
  errors << "CURRENT_STATE current_task #{current_task.inspect} is absent from active_ownership #{active_task_ids.inspect}"
end

recommended_milestone = state.dig("recommended_next_task", "milestone")
if recommended_milestone && state["current_milestone"] != recommended_milestone
  errors << "CURRENT_STATE current_milestone and recommended_next_task.milestone differ"
end

execution_plan_path = root.join(state.fetch("execution_plan", "21_IMPLEMENTATION_EXECUTION_PLAN.md"))
if execution_plan_path.exist?
  execution_plan = File.read(execution_plan_path)
  {
    "There is no real local MP4 walking slice yet" => "execution plan still denies the implemented local MP4",
    "Worker packages expose health boundaries only" => "execution plan still denies the implemented ASR/render workers",
    "Python does not yet produce or verify RFC 8785 canonical JSON hashes" => "execution plan still treats the approved TypeScript-only JCS boundary as unfinished"
  }.each do |stale_text, message|
    errors << message if execution_plan.include?(stale_text)
  end
end

if manifest["schema_version"] != state["context_schema_version"]
  errors << "MANIFEST schema_version and CURRENT_STATE context_schema_version differ"
end

live_profile = Array(manifest.dig("read_profiles", "live_development"))
%w[05_UI_UX_SPEC.md 12_DEVELOPMENT_PLAN.md 19_IMPLEMENTATION_PLAYBOOK.md].each do |required_path|
  errors << "live_development profile is missing #{required_path}" unless live_profile.include?(required_path)
end
playbook_text = File.read(root.join("19_IMPLEMENTATION_PLAYBOOK.md"))
%w[pnpm\ doctor pnpm\ dev pnpm\ dev:status pnpm\ dev:open pnpm\ test:chrome pnpm\ verify].each do |command|
  errors << "implementation playbook is missing stable command: #{command}" unless playbook_text.include?(command)
end
live_state = state["live_development"] || {}
%w[expected_url server_state dev_server_pid owner_task_id health_checked_at chrome_route fixture_scenario provider_mode provider_calls_authorized authorized_spend_usd last_user_checkpoint].each do |field|
  errors << "CURRENT_STATE live_development is missing #{field}" unless live_state.key?(field)
end
errors << "CURRENT_STATE must default to fixture provider mode before implementation" unless live_state["provider_mode"] == "fixture"
checkpoint = live_state["last_user_checkpoint"] || {}
%w[result commit route scenario checked_at feedback_refs].each do |field|
  errors << "CURRENT_STATE last_user_checkpoint is missing #{field}" unless checkpoint.key?(field)
end

recommended_task = state["recommended_next_task"] || {}
recommended_profile = recommended_task["read_profile"]
errors << "CURRENT_STATE recommended next task names an unknown read profile: #{recommended_profile}" unless (manifest["read_profiles"] || {}).key?(recommended_profile)
if recommended_task["provider_calls_authorized"] == false
  errors << "CURRENT_STATE provider-free next task must default to $0 external spend" unless recommended_task["maximum_external_spend_usd"] == 0
elsif recommended_task["provider_calls_authorized"] == true
  authority = recommended_task["provider_authority"] || {}
  cap = recommended_task["maximum_external_spend_usd"]
  errors << "CURRENT_STATE live provider task requires a positive numeric cap" unless cap.is_a?(Numeric) && cap.positive?
  errors << "CURRENT_STATE live provider task requires an exact provider" unless authority["provider"].is_a?(String) && !authority["provider"].empty?
  errors << "CURRENT_STATE live provider task requires an exact model_id" unless authority["model_id"].is_a?(String) && !authority["model_id"].empty?
  errors << "CURRENT_STATE live provider cap must be explicitly non-transferable" unless authority["non_transferable"] == true
  errors << "CURRENT_STATE live provider cap disagrees with provider_authority" unless authority["cap_usd"] == cap
  errors << "CURRENT_STATE live provider task requires an authorization timestamp" unless authority["authorized_by_user_at"].is_a?(String) && !authority["authorized_by_user_at"].empty?
  errors << "CURRENT_STATE live provider task cap must match live_development" unless live_state["authorized_spend_usd"] == cap
else
  errors << "CURRENT_STATE recommended next task must explicitly declare provider_calls_authorized"
end

declared_paths = Array(manifest["mandatory_read"])
Array(manifest.dig("read_profiles")&.values).flatten.each { |value| declared_paths << value }
%w[maintenance current_state gate_registry glossary implementation_playbook context_validator schema_validator].each do |key|
  declared_paths << manifest[key] if manifest[key]
end

declared_paths.compact.uniq.each do |relative|
  errors << "manifest path missing: #{relative}" unless root.join(relative).exist?
end

%w[context_validator schema_validator].each do |key|
  relative = manifest[key]
  errors << "#{key} is not executable: #{relative}" if relative && root.join(relative).exist? && !root.join(relative).executable?
end

json_files = Dir[root.join("**/*.json").to_s].sort
class DuplicateRejectingHash < Hash
  def []=(key, value)
    raise "duplicate JSON key: #{key}" if key?(key)
    super
  end
end
json_files.each do |path|
  begin
    JSON.parse(File.read(path), object_class: DuplicateRejectingHash)
  rescue StandardError => e
    errors << "#{Pathname.new(path).relative_path_from(root)}: JSON parse failed: #{e.message}"
  end
end

fixture_dir = root.join("evidence/fixtures")
create_fixture = fixture_dir.join("create_project_request.valid.json")
revision_fixture = fixture_dir.join("project_revision_config.valid.json")
timeline_fixture = fixture_dir.join("timeline_plan.valid.json")
render_fixture = fixture_dir.join("resolved_render_manifest.valid.json")
production_fixture = fixture_dir.join("production_manifest.valid.json")
default_style_fixture = root.join("evidence/default_image_style_v1.json")
avatar_profile_fixture = fixture_dir.join("avatar_profile_version.valid.json")
if [create_fixture, revision_fixture, timeline_fixture, render_fixture, production_fixture, default_style_fixture, avatar_profile_fixture].all?(&:exist?)
  begin
    create = JSON.parse(File.read(create_fixture))
    revision = JSON.parse(File.read(revision_fixture))
    timeline = JSON.parse(File.read(timeline_fixture))
    render = JSON.parse(File.read(render_fixture))
    production = JSON.parse(File.read(production_fixture))
    default_style = JSON.parse(File.read(default_style_fixture))
    avatar_profile = JSON.parse(File.read(avatar_profile_fixture))
    segments = timeline.fetch("segments")
    resolved = render.fetch("segments")

    errors << "golden fixtures: create/revision title differs" unless create["title"] == revision["title"]
    errors << "golden fixtures: create/revision voiceover differs" unless create["voiceover_asset_id"] == revision["voiceover_asset_id"]
    errors << "golden fixtures: create/revision Avatar Profile version differs" unless create["avatar_profile_version_id"] == revision.dig("avatar_binding", "avatar_profile_version_id")
    errors << "golden fixtures: create/revision style differs" unless create["image_style_version_id"] == revision["image_style_version_id"]
    %w[optional_script extra_prompt_keywords apply_extra_prompt_keywords generation_mode spend_cap_usd].each do |field|
      errors << "golden fixtures: create/revision #{field} differs" unless create[field] == revision[field]
    end
    if create["user_seed"].is_a?(Integer)
      errors << "golden fixtures: requested seed differs" unless create["user_seed"] == revision["scheduler_seed"]
    end

    expected_revision_hash = fixture_hash(revision)
    expected_timeline_hash = fixture_hash(timeline)
    expected_render_hash = fixture_hash(render)
    expected_style_hash = fixture_hash(default_style)
    expected_avatar_profile_hash = fixture_hash(avatar_profile)
    errors << "golden fixtures: revision IDs differ" unless [
      revision["project_revision_id"], timeline["project_revision_id"], render["project_revision_id"], production["project_revision_id"]
    ].uniq.length == 1
    errors << "golden fixtures: timeline must start at frame zero" unless segments.first && segments.first["start_frame"] == 0
    errors << "golden fixtures: timeline final frame differs from total_frames" unless segments.last && segments.last["end_frame_exclusive"] == timeline["total_frames"]
    segments.each_cons(2) do |left, right|
      errors << "golden fixtures: timeline frame gap/overlap" unless left["end_frame_exclusive"] == right["start_frame"]
      errors << "golden fixtures: timeline word gap/overlap" unless left["word_end_exclusive"] == right["word_start"]
    end
    errors << "golden fixtures: render total_frames differs" unless render["total_frames"] == timeline["total_frames"]
    errors << "golden fixtures: revision-config hash is not content-derived" unless timeline["revision_config_hash"] == expected_revision_hash && render["revision_config_hash"] == expected_revision_hash && production["revision_config_hash"] == expected_revision_hash
    errors << "golden fixtures: timeline hash is not content-derived" unless render["timeline_plan_hash"] == expected_timeline_hash && production.dig("timeline_plan", "sha256") == expected_timeline_hash
    errors << "golden fixtures: resolved-render hash is not content-derived" unless production.dig("resolved_render_manifest", "sha256") == expected_render_hash
    errors << "golden fixtures: default style hash is not content-derived" unless revision["style_profile_hash"] == expected_style_hash && production.dig("style_binding", "style_profile_hash") == expected_style_hash
    errors << "golden fixtures: Avatar Profile hash is not content-derived" unless revision.dig("avatar_binding", "avatar_profile_hash") == expected_avatar_profile_hash && production.dig("avatar_binding", "avatar_profile_hash") == expected_avatar_profile_hash
    errors << "golden fixtures: Avatar runtime source differs from profile" unless revision.dig("avatar_binding", "runtime_source_asset_id") == avatar_profile["runtime_source_asset_id"] && revision.dig("avatar_binding", "runtime_source_sha256") == avatar_profile["runtime_source_sha256"]
    compatibility_state = revision.dig("avatar_binding", "compatibility_state_at_preflight")
    compatibility_evidence = revision.dig("avatar_binding", "compatibility_evidence")
    if %w[UNTESTED RUNNING].include?(compatibility_state)
      errors << "golden fixtures: nonterminal Avatar compatibility must not claim immutable evidence" unless compatibility_evidence.nil?
    else
      errors << "golden fixtures: Avatar compatibility state/evidence differs" unless compatibility_evidence.is_a?(Hash) && compatibility_evidence["status"] == compatibility_state
    end
    errors << "golden fixtures: voiceover binding differs" unless render.dig("voiceover", "asset_id") == revision["voiceover_asset_id"] && render.dig("voiceover", "sha256") == revision["voiceover_sha256"]
    errors << "golden fixtures: production project differs" unless production["project_id"] == revision["project_id"]
    errors << "golden fixtures: production style version differs" unless production.dig("style_binding", "image_style_version_id") == revision["image_style_version_id"]
    errors << "golden fixtures: production Avatar binding differs" unless production["avatar_binding"] == revision["avatar_binding"]
    errors << "golden fixtures: production final frames differ" unless production.dig("final_output", "total_frames") == render["total_frames"]

    expected_rows = segments.map { |row| row.values_at("segment_id", "start_frame", "end_frame_exclusive", "timeline_composition") }
    resolved_rows = resolved.map { |row| row.values_at("segment_id", "start_frame", "end_frame_exclusive", "timeline_composition") }
    errors << "golden fixtures: resolved segment identities/bounds differ" unless resolved_rows == expected_rows
  rescue StandardError => e
    errors << "golden fixture semantic validation failed: #{e.message}"
  end
end

begin
  create_schema = JSON.parse(File.read(root.join("evidence/create_project_request.schema.json")))
  create_schema_text = JSON.generate(create_schema)
  errors << "create-project schema must require avatar_profile_version_id" unless Array(create_schema["required"]).include?("avatar_profile_version_id")
  errors << "create-project schema still exposes a project-local avatar upload branch" if create_schema_text.include?("IMAGE_ASSET") || create_schema_text.include?("avatar_image_asset_id") || create_schema_text.include?("avatar_source")
  errors << "create-project schema must enforce the $2.00 MVP cap ceiling" unless create_schema.dig("properties", "spend_cap_usd", "maximum") == 2
  invalid_inline = JSON.parse(File.read(root.join("evidence/fixtures/create_project_request.invalid.inline_avatar.json")))
  errors << "negative inline-avatar fixture no longer exercises the removed shape" unless invalid_inline.dig("avatar_source", "kind") == "IMAGE_ASSET" && invalid_inline.dig("avatar_source", "avatar_image_asset_id")
  invalid_over_budget = JSON.parse(File.read(root.join("evidence/fixtures/create_project_request.invalid.over_budget.json")))
  errors << "negative over-budget fixture no longer exceeds the MVP ceiling" unless invalid_over_budget["spend_cap_usd"].is_a?(Numeric) && invalid_over_budget["spend_cap_usd"] > 2
rescue StandardError => e
  errors << "create-project Avatar Hub contract validation failed: #{e.message}"
end

begin
  revision_schema = JSON.parse(File.read(root.join("evidence/project_revision_config.schema.json")))
  production_schema = JSON.parse(File.read(root.join("evidence/production_manifest.schema.json")))
  planning_cost = JSON.parse(File.read(root.join("evidence/planning_cost_model.json")))
  errors << "project-revision schema must enforce the $2.00 MVP cap ceiling" unless revision_schema.dig("properties", "spend_cap_usd", "maximum") == 2
  errors << "planning cost model and request/revision cap ceiling differ" unless planning_cost.dig("targets", "mvp_contract_cap_max") == 2 && planning_cost.dig("targets", "default_hard_cap") == 1.5
  [
    ["project-revision", revision_schema.dig("properties", "avatar_binding")],
    ["production-manifest", production_schema.dig("properties", "avatar_binding")]
  ].each do |label, binding|
    required = Array(binding && binding["required"])
    errors << "#{label} Avatar binding must pin compatibility_state_at_preflight" unless required.include?("compatibility_state_at_preflight")
    errors << "#{label} Avatar binding must pin compatibility_evidence" unless required.include?("compatibility_evidence")
  end
  invalid_compatibility = JSON.parse(File.read(root.join("evidence/fixtures/project_revision_config.invalid.compatibility_mismatch.json")))
  invalid_state = invalid_compatibility.dig("avatar_binding", "compatibility_state_at_preflight")
  invalid_evidence_state = invalid_compatibility.dig("avatar_binding", "compatibility_evidence", "status")
  errors << "negative Avatar compatibility fixture no longer exercises a state/evidence mismatch" unless invalid_state == "PASSED" && invalid_evidence_state == "FAILED"
rescue StandardError => e
  errors << "revision/production budget and Avatar provenance validation failed: #{e.message}"
end

begin
  render_schema_text = File.read(root.join("evidence/resolved_render_manifest.schema.json"))
  errors << "resolved-render schema is missing the AvatarForcing source profile" unless render_schema_text.include?("avatarforcing-centered-832x480p25-v1")
  errors << "resolved-render schema is missing the SkyReels source profile" unless render_schema_text.include?("skyreels-centered-960x960p25-v2")
  invalid_profile_crop = JSON.parse(File.read(root.join("evidence/fixtures/resolved_render_manifest.invalid.avatar_profile_crop.json")))
  invalid_render = invalid_profile_crop.dig("segments", 0, "render") || {}
  errors << "negative avatar profile/crop fixture no longer exercises the mismatch" unless invalid_render["avatar_source_profile"] == "skyreels-centered-960x960p25-v2" && invalid_render["avatar_crop"] == "832:468:0:6"
rescue StandardError => e
  errors << "avatar renderer source-profile validation failed: #{e.message}"
end

start_text = File.read(root.join("00_START_HERE.md"))
errors << "00_START_HERE still describes an unpinned original-image avatar input" if start_text.include?("Original image + selected audio")
product_text = File.read(root.join("01_PRODUCT_REQUIREMENTS.md"))
%w[`script` `project_seed` `cost_cap_usd`].each do |stale_field|
  errors << "01_PRODUCT_REQUIREMENTS still uses stale request field #{stale_field}" if product_text.include?(stale_field)
end

Dir[root.join("**/*.csv").to_s].sort.each do |path|
  begin
    CSV.read(path, headers: true)
  rescue StandardError => e
    errors << "#{Pathname.new(path).relative_path_from(root)}: CSV parse failed: #{e.message}"
  end
end

ledger = File.read(root.join("15_DECISIONS_AND_OPEN_GATES.md"))
ledger_decisions = ledger.scan(/\`(DEC_[A-Z0-9_]+)\`/).flatten.uniq.sort
ledger_gates = ledger.scan(/\`(GATE_[A-Z0-9_]+)\`/).flatten.uniq.sort
manifest_decisions = (manifest["approved_decisions"] || {}).keys.sort
manifest_open_gates = (manifest["open_gates"] || {}).keys.sort
manifest_closed_gates = (manifest["closed_gates"] || {}).keys.sort
manifest_gates = (manifest_open_gates + manifest_closed_gates).uniq.sort
registry_gates = (gates["gates"] || {}).keys.sort
registry_open_gates = (gates["gates"] || {}).select { |_id, record| record["status"] == "open" }.keys.sort
registry_closed_gates = (gates["gates"] || {}).select { |_id, record| record["status"] == "closed" }.keys.sort

errors << "decision IDs differ between MANIFEST and decision ledger" unless manifest_decisions == ledger_decisions
errors << "gate IDs differ between MANIFEST and decision ledger" unless manifest_gates == ledger_gates
errors << "gate IDs differ between MANIFEST and GATES.yaml" unless manifest_gates == registry_gates
errors << "gate ID appears in both MANIFEST open_gates and closed_gates" unless (manifest_open_gates & manifest_closed_gates).empty?
errors << "open gate IDs differ between MANIFEST and GATES.yaml" unless manifest_open_gates == registry_open_gates
errors << "closed gate IDs differ between MANIFEST and GATES.yaml" unless manifest_closed_gates == registry_closed_gates

(gates["gates"] || {}).each do |gate_id, record|
  status = record["status"].to_s
  errors << "#{gate_id}: invalid status #{status.inspect}" unless %w[open closed].include?(status)

  last_run = record["last_run"].to_s
  errors << "#{gate_id}: closed gate requires last_run evidence" if status == "closed" && last_run.empty?
  unless last_run.empty?
    evidence_path = root.join(last_run)
    errors << "#{gate_id}: last_run evidence missing: #{last_run}" unless evidence_path.exist?
  end

  acceptance = record["acceptance"].to_s
  file, anchor = acceptance.split("#", 2)
  errors << "#{gate_id}: acceptance file missing: #{file}" if file.empty? || !root.join(file).exist?
  next if file.empty? || !root.join(file).exist? || anchor.to_s.empty?

  headings = File.readlines(root.join(file)).each_with_object([]) do |line, result|
    match = line.match(/^\#{1,6}\s+(.+?)\s*#*\s*$/)
    next unless match
    result << match[1]
      .downcase
      .gsub(/<[^>]*>/, "")
      .gsub(/[`*_~]/, "")
      .gsub(/[^\p{L}\p{N}\-_ ]/u, "")
      .strip
      .gsub(/\s+/, "-")
  end
  errors << "#{gate_id}: acceptance anchor missing: #{acceptance}" unless headings.include?(anchor)
end

state_gates = Array(state["blocking_gates_for_production"])
unknown_state_gates = state_gates - registry_gates
errors << "CURRENT_STATE contains unknown blocking gates: #{unknown_state_gates.join(", ")}" unless unknown_state_gates.empty?
closed_state_gates = state_gates & registry_closed_gates
errors << "CURRENT_STATE lists closed gates as blocking: #{closed_state_gates.join(", ")}" unless closed_state_gates.empty?

asset_manifest = root.join("evidence/asset_manifest.csv")
asset_rows = asset_manifest.exist? ? CSV.read(asset_manifest, headers: true) : []
optional_asset_paths = asset_rows.each_with_object([]) do |row, paths|
  next unless row["rights_status"].to_s.match?(/third_party|historical_research/)
  paths << root.join(row["path"]).cleanpath
end

link_pattern = /!?\[[^\]]*\]\(([^)]+)\)/
Dir[root.join("**/*.md").to_s].sort.each do |path|
  text = File.read(path)
  text.scan(link_pattern).flatten.each do |raw|
    target = raw.strip.delete_prefix("<").delete_suffix(">")
    next if target.empty? || target.start_with?("#", "http://", "https://", "mailto:")
    target = target.split("#", 2).first
    next if target.empty?
    resolved = Pathname.new(path).dirname.join(target).cleanpath
    next if resolved.exist?
    message = "#{Pathname.new(path).relative_path_from(root)}: broken link #{raw}"
    (optional_asset_paths.include?(resolved) ? warnings : errors) <<
      "#{message}#{optional_asset_paths.include?(resolved) ? " (local_optional)" : ""}"
  end
end

unless asset_rows.empty?
  asset_rows.each do |row|
    path = root.join(row["path"])
    optional = row["rights_status"].to_s.match?(/third_party|historical_research/)
    unless path.exist?
      (optional ? warnings : errors) << "asset missing#{optional ? " (local_optional)" : ""}: #{row["path"]}"
      next
    end
    actual = Digest::SHA256.file(path).hexdigest
    errors << "asset checksum mismatch: #{row["path"]}" unless actual == row["sha256"]
  end
end

frames_csv = root.join("references/ranga/frames/frames.csv")
if frames_csv.exist?
  CSV.foreach(frames_csv, headers: true) do |row|
    path = frames_csv.dirname.join(row["filename"])
    unless path.exist?
      warnings << "Ranga frame missing (local_optional): #{row["filename"]}"
      next
    end
    actual = Digest::SHA256.file(path).hexdigest
    errors << "Ranga frame checksum mismatch: #{row["filename"]}" unless actual == row["sha256"]
  end
end

budget = Integer(manifest["target_profile_word_budget"] || 0)
(manifest["read_profiles"] || {}).each do |name, files|
  words = Array(files).sum do |relative|
    path = root.join(relative)
    path.file? ? File.read(path).split.size : 0
  end
  warnings << "read profile #{name} is #{words} words (target #{budget})" if budget.positive? && words > budget
  errors << "read profile #{name} exceeds 1.5x word budget (#{words} > #{(budget * 1.5).to_i})" if budget.positive? && words > budget * 1.5
end

secret_patterns = {
  "AWS access key" => /AKIA[0-9A-Z]{16}/,
  "OpenAI-like secret" => /sk-[A-Za-z0-9_-]{24,}/,
  "private key block" => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
}
Dir[root.join("**/*").to_s].sort.each do |path|
  next unless File.file?(path)
  next unless %w[.md .yaml .yml .json .csv .txt .sh].include?(File.extname(path))
  text = File.read(path)
  secret_patterns.each do |label, pattern|
    errors << "#{Pathname.new(path).relative_path_from(root)}: possible #{label}" if text.match?(pattern)
  end
end

puts "VideoForge context validation"
puts "  JSON files: #{json_files.length}"
puts "  read profiles: #{(manifest["read_profiles"] || {}).length}"
puts "  decisions: #{manifest_decisions.length}"
puts "  gates: #{manifest_gates.length}"
warnings.uniq.each { |warning| warn "WARNING: #{warning}" }
errors.uniq.each { |error| warn "ERROR: #{error}" }
exit(errors.empty? ? 0 : 1)
RUBY
