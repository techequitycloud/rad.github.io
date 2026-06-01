#!/usr/bin/env python3
"""Apply updates from updates/ sub-projects to docs/."""
import os
import sys

# Import helper functions from the existing script
sys.path.insert(0, '/home/user/rad.github.io')
from apply_module_updates import apply_update, find_front_matter_end

BASE = '/home/user/rad.github.io'
DOCS = os.path.join(BASE, 'docs')

# Name normalisation table
NAME_MAP = {
    # features (update name → docs name)
    "admins": "admin",
    "agents": "agent",
    "partners": "partner",
    "users": "user",
    # guides (strip -guide suffix)
    "admin-guide": "admin",
    "agent-guide": "agent",
    "finance-guide": "finance",
    "partner-guide": "partner",
    "support-guide": "support",
    "user-guide": "user",
    # capabilities
    "data": "data_and_databases",
    "disaster_recovery": "disaster_recovery",
    "multitenancy": "multitenancy_saas",
    "application-modernization": "modernization",
    "hybrid-cloud-fleet": "hybrid-cloud",
    "kubernetes": "kubernetes",
    "networking-zero-trust": "networking",
    "data_and_databases": "data_and_databases",
    "multitenancy_saas": "multitenancy_saas",
    "container-orchestration": "kubernetes",
    # outcomes
    "compliance": "compliance_governance",
    "cost_optimisation": "cost_optimisation",
    "cost-optimization": "cost_optimisation",
    "developer_productivity": "developer_productivity",
    "developer-productivity": "developer_productivity",
    "education": "education_enablement",
    "operational_reliability": "modernisation",
    "compliance_governance": "compliance_governance",
    "compliance-governance": "compliance_governance",
    "education_enablement": "education_enablement",
    "skills-development": "education_enablement",
    "modernisation": "modernisation",
    "modernization": "modernisation",
    "security_zero_trust": "security_zero_trust",
    "zero-trust-security": "security_zero_trust",
    # practices
    "gitops_iac": "gitops_iac",
    "gitops-iac": "gitops_iac",
    "platform_engineering": "platform_engineering",
    "platform-engineering": "platform_engineering",
    "developer-productivity": "platform_engineering",  # skip — no matching target
    # tutorials (strip numbering prefix)
    "01-getting-started": "getting-started",
    "02-admin-tutorial": "admin",
    "03-partner-tutorial": "partner",
    "04-user-tutorial": "user",
    "05-agent-tutorial": "agent",
    "06-finance-tutorial": "finance",
    "07-support-tutorial": "support",
    "08-roi-tutorial": "roi",
}

# Flat directories where name normalisation applies
FLAT_DIRS = {"capabilities", "features", "guides", "practices", "outcomes", "tutorials", "workflows"}
# Directories that map to subdir/subdir.md (created if missing)
SUBDIR_DIRS = {"labs", "modules"}
# Directories copied flat (no normalisation, create if needed)
FLAT_CREATE_DIRS = {"certification", "runbooks"}

# Sub-project sources in priority order (last wins for conflicts)
SOURCES = ["rad-modules", "rad-automation", "partner-modules"]


def normalise_name(name, section):
    """Return the normalised docs filename stem (without .md)."""
    # Apply explicit map first
    if name in NAME_MAP:
        return NAME_MAP[name]
    # Fallback: replace underscores with hyphens
    return name.replace("_", "-")


def resolve_target(update_file_path):
    """
    Given an update file path, return (target_abs_path, should_create).
    Returns (None, False) if the file should be skipped.
    """
    rel = os.path.relpath(update_file_path, BASE)
    # rel looks like: updates/<project>/docs/<section>/<filename>.md

    parts = rel.split(os.sep)
    # parts: ['updates', '<project>', 'docs', '<section>', '<filename>.md']
    if len(parts) < 5:
        return None, False

    section = parts[3]
    filename = parts[4]

    # Skip implementation directories
    if section == "implementation":
        return None, False

    # Skip README files
    if filename.lower() == "readme.md":
        return None, False

    name_stem = os.path.splitext(filename)[0]

    if section in FLAT_DIRS:
        normalised = normalise_name(name_stem, section)
        # If the name_map maps to "idp" for developer-productivity, check existence
        target_filename = normalised + ".md"
        target_path = os.path.join(DOCS, section, target_filename)
        # Skip if target does not exist
        if not os.path.exists(target_path):
            return None, False
        return target_path, False

    elif section in SUBDIR_DIRS:
        # maps to docs/<section>/<stem>/<stem>.md — always create
        target_dir = os.path.join(DOCS, section, name_stem)
        target_path = os.path.join(target_dir, filename)
        return target_path, True

    elif section in FLAT_CREATE_DIRS:
        target_path = os.path.join(DOCS, section, filename)
        return target_path, True

    else:
        # Unknown section — skip
        return None, False


def create_new_doc(update_path, target_path):
    with open(update_path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.splitlines()
    # Check if already has front matter
    if lines and lines[0].strip() == '---':
        result = content
    else:
        title = lines[0].lstrip('# ').strip() if lines and lines[0].startswith('# ') else 'Documentation'
        base = os.path.splitext(os.path.basename(target_path))[0]
        sidebar = base.replace('_', ' ')
        front_matter = f'---\ntitle: "{title}"\nsidebar_label: "{sidebar}"\n---\n'
        result = front_matter + '\n' + content

    if not result.endswith('\n'):
        result += '\n'

    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(result)


def apply_file_update(update_path, target_path):
    """Apply the update to the existing target file."""
    with open(target_path, 'r', encoding='utf-8') as f:
        original_content = f.read()

    with open(update_path, 'r', encoding='utf-8') as f:
        update_content = f.read()

    has_video = 'YouTubeEmbed' in original_content
    result = apply_update(original_content, update_content, has_video)

    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(result)


def collect_updates():
    """
    Walk all update files in priority order and build a dict:
    target_path → (update_path, should_create)
    Later entries (higher priority) overwrite earlier ones.
    """
    plan = {}  # target_path -> (update_path, should_create)
    skipped = []

    for project in SOURCES:
        project_docs = os.path.join(BASE, 'updates', project, 'docs')
        if not os.path.isdir(project_docs):
            continue

        for section in sorted(os.listdir(project_docs)):
            section_dir = os.path.join(project_docs, section)
            if not os.path.isdir(section_dir):
                continue

            for fname in sorted(os.listdir(section_dir)):
                if not fname.endswith('.md'):
                    continue

                update_path = os.path.join(section_dir, fname)
                target_path, should_create = resolve_target(update_path)

                if target_path is None:
                    rel_upd = os.path.relpath(update_path, BASE)
                    # Don't report implementation/ or README skips noisily, but do report normalised-name misses
                    parts = rel_upd.split(os.sep)
                    section_name = parts[3] if len(parts) >= 4 else '?'
                    if section_name not in ('implementation',) and fname.lower() != 'readme.md':
                        skipped.append((rel_upd, 'no matching target in docs/'))
                    continue

                plan[target_path] = (update_path, should_create)

    return plan, skipped


def main():
    plan, skipped = collect_updates()

    updated = []
    created = []
    errors = []

    for target_path in sorted(plan.keys()):
        update_path, should_create = plan[target_path]
        rel_target = os.path.relpath(target_path, BASE)
        rel_update = os.path.relpath(update_path, BASE)

        try:
            if should_create or not os.path.exists(target_path):
                create_new_doc(update_path, target_path)
                created.append(rel_target)
            else:
                apply_file_update(update_path, target_path)
                updated.append(rel_target)
        except Exception as e:
            errors.append(f'{rel_target}: {e}')

    # Report
    print(f'Updated {len(updated)} existing docs:')
    for p in sorted(updated):
        print(f'  {p}')

    print(f'\nCreated {len(created)} new docs:')
    for p in sorted(created):
        print(f'  {p}')

    if skipped:
        print(f'\nSkipped {len(skipped)} files (no matching target):')
        for rel, reason in sorted(skipped):
            print(f'  {rel} — {reason}')

    if errors:
        print(f'\nErrors ({len(errors)}):')
        for e in errors:
            print(f'  {e}')

    print(f'\nSummary: {len(updated)} updated, {len(created)} created, {len(skipped)} skipped, {len(errors)} errors')


if __name__ == '__main__':
    main()
