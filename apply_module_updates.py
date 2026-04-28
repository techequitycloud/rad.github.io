#!/usr/bin/env python3
"""Apply updates/modules/* to docs/modules/* while preserving Docusaurus front matter and video sections."""
import os
import subprocess

BASE = '/home/user/rad.github.io'

NEW_FILES = {
    'GCP_Services_Guide': 'docs/modules/GCP_Services/GCP_Services_Guide.md',
    'MULTI_CLUSTER_GUIDE': 'docs/modules/MULTI_CLUSTER_GUIDE/MULTI_CLUSTER_GUIDE.md',
    'Services_GCP_Deep_Dive_Analysis': 'docs/modules/GCP_Services/GCP_Services_Deep_Dive.md',
    'GCP_SERVICES': 'docs/modules/GCP_Services/GCP_Services_Analysis.md',
}

def get_published_rel_path(base):
    if base == 'Services_GCP':
        return 'docs/modules/GCP_Services/GCP_Services.md'
    return f'docs/modules/{base}/{base}.md'


def git_show_original(rel_path):
    result = subprocess.run(
        ['git', 'cat-file', '-p', f'HEAD:{rel_path}'],
        capture_output=True, text=True, cwd=BASE
    )
    return result.stdout if result.returncode == 0 else None


def find_front_matter_end(lines):
    if not lines or lines[0].strip() != '---':
        return 0
    for i in range(1, min(20, len(lines))):
        if lines[i].strip() == '---':
            return i + 1
    return 0


def find_header_end(lines):
    """
    Return the line index where the header ends and the body begins.
    For files with video embeds: after all blank lines following the PDF link.
    For Common modules (no video): just after the closing --- of front matter + blank.
    Returns -1 if no front matter found.
    """
    fm_end = find_front_matter_end(lines)
    if fm_end == 0:
        return -1

    pos = fm_end
    # Skip blank lines after front matter
    while pos < len(lines) and lines[pos].strip() == '':
        pos += 1

    # Check for a module heading
    if pos >= len(lines) or not lines[pos].startswith('# '):
        return fm_end  # no heading, body starts right after front matter

    heading_idx = pos
    pos += 1

    # Skip blank lines after heading
    while pos < len(lines) and lines[pos].strip() == '':
        pos += 1

    # Check for YouTubeEmbed
    if pos >= len(lines) or 'YouTubeEmbed' not in lines[pos]:
        # No video — Common module; body starts at the heading line
        return heading_idx

    pos += 1  # past YouTubeEmbed
    while pos < len(lines) and lines[pos].strip() == '':
        pos += 1

    # <br/>
    if pos < len(lines) and '<br/>' in lines[pos]:
        pos += 1
        while pos < len(lines) and lines[pos].strip() == '':
            pos += 1

    # PDF link
    if pos < len(lines) and '<a href=' in lines[pos]:
        pos += 1
        # Skip all blank lines after PDF link — these are part of the header section
        while pos < len(lines) and lines[pos].strip() == '':
            pos += 1

    return pos  # body starts here


def strip_update_front_matter(upd_lines):
    """If the update file starts with YAML front matter, return the index of first content line."""
    if not upd_lines or upd_lines[0].strip() != '---':
        return 0  # No front matter; content starts at line 0 (the heading)
    fm_end = find_front_matter_end(upd_lines)
    # Skip blank lines after front matter
    pos = fm_end
    while pos < len(upd_lines) and upd_lines[pos].strip() == '':
        pos += 1
    return pos  # points to the heading line in the update file


def apply_update(original_content, update_content, has_video):
    pub_lines = original_content.splitlines()
    upd_lines = update_content.splitlines()

    # Normalize update file: find where its actual heading starts
    upd_heading_start = strip_update_front_matter(upd_lines)

    header_end = find_header_end(pub_lines)
    if header_end < 0:
        # No front matter — just use update content as-is
        result = update_content
    elif has_video:
        # Preserve exact original header (front matter + heading + video/PDF + blanks)
        original_header = '\n'.join(pub_lines[:header_end])
        # Skip the update's heading line + trailing blanks
        upd_body_start = upd_heading_start + 1
        while upd_body_start < len(upd_lines) and upd_lines[upd_body_start].strip() == '':
            upd_body_start += 1
        update_body = '\n'.join(upd_lines[upd_body_start:])
        result = original_header + '\n' + update_body
    else:
        # Common module: preserve only the front matter
        fm_end = find_front_matter_end(pub_lines)
        original_fm = '\n'.join(pub_lines[:fm_end])
        # Use update content starting from its heading
        update_body = '\n'.join(upd_lines[upd_heading_start:])
        result = original_fm + '\n\n' + update_body

    return result.rstrip('\n') + '\n'


def create_new_doc(update_path, published_path):
    with open(update_path, 'r') as f:
        content = f.read()

    lines = content.splitlines()
    title = lines[0].lstrip('# ').strip() if lines and lines[0].startswith('# ') else 'Documentation'
    base = os.path.splitext(os.path.basename(published_path))[0]
    sidebar = base.replace('_', ' ')

    front_matter = f'---\ntitle: "{title}"\nsidebar_label: "{sidebar}"\n---\n'
    result = front_matter + '\n' + content
    if not result.endswith('\n'):
        result += '\n'

    os.makedirs(os.path.dirname(published_path), exist_ok=True)
    with open(published_path, 'w') as f:
        f.write(result)


def main():
    updates_dir = os.path.join(BASE, 'updates/modules')
    changed = []
    created = []
    skipped = []

    for fname in sorted(os.listdir(updates_dir)):
        if not fname.endswith('.md'):
            continue
        base = fname[:-3]
        update_path = os.path.join(updates_dir, fname)

        if base in NEW_FILES:
            published_path = os.path.join(BASE, NEW_FILES[base])
            create_new_doc(update_path, published_path)
            created.append(published_path.replace(BASE + '/', ''))
            continue

        if base == 'GCP_SERVICES':
            continue

        pub_rel = get_published_rel_path(base)
        published_path = os.path.join(BASE, pub_rel)

        if not os.path.exists(published_path):
            skipped.append(f'{base} (no published file at {pub_rel})')
            continue

        original_content = git_show_original(pub_rel)
        if original_content is None:
            with open(published_path, 'r') as f:
                original_content = f.read()

        with open(update_path, 'r') as f:
            update_content = f.read()

        has_video = 'YouTubeEmbed' in original_content
        result = apply_update(original_content, update_content, has_video)

        with open(published_path, 'w') as f:
            f.write(result)
        changed.append(pub_rel)

    print(f'Updated {len(changed)} existing docs:')
    for p in changed:
        print(f'  {p}')
    print(f'\nCreated {len(created)} new docs:')
    for p in created:
        print(f'  {p}')
    if skipped:
        print(f'\nSkipped:')
        for s in skipped:
            print(f'  {s}')


if __name__ == '__main__':
    main()
