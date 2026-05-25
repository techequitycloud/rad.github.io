#!/usr/bin/env python3
"""Update all documentation pages to use YouTube embeds with GCS thumbnails and PDF links."""

import re
import os

BASE_DIR = '/home/user/rad.github.io'
GCS_BASE = 'https://storage.googleapis.com/rad-public-2b65'

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Updated: {path}')

def make_youtube_embed(video_id, poster=None):
    if poster:
        return f'<YouTubeEmbed videoId="{video_id}" poster="{poster}" />'
    return f'<YouTubeEmbed videoId="{video_id}" />'

def make_pdf_link(pdf_url):
    return f'<a href="{pdf_url}" target="_blank">View Presentation (PDF)</a>'


# ============================================================
# Type 1: Workflow/Guide pages with GCS img + video (no PDF)
# Replace img + video block with YouTubeEmbed using img as poster
# ============================================================

def update_type1(path, video_id):
    """Pages with <img> + <video> tags, no PDF. Replace with YouTubeEmbed."""
    content = read_file(path)

    # Pattern: <img src="URL" ... /> ... <video ...>...</video>
    # Capture the img src URL
    img_pattern = re.compile(
        r'<img\s+src="([^"]+)"[^>]*/>\s*\n\n'
        r'<video[^>]*>\s*\n'
        r'\s*<source[^>]*/>\s*\n'
        r'\s*Your browser does not support the video tag\.\s*\n'
        r'</video>',
        re.DOTALL
    )

    m = img_pattern.search(content)
    if m:
        img_url = m.group(1)
        embed = make_youtube_embed(video_id, img_url)
        new_content = content[:m.start()] + embed + content[m.end():]
        write_file(path, new_content)
        return True
    else:
        print(f'WARNING: Pattern not found in {path}')
        return False


# ============================================================
# Type 2: Features pages with GCS img + video + PDF link
# Replace img + video block with YouTubeEmbed, keep PDF link
# ============================================================

def update_type2(path, video_id):
    """Pages with <img> + <br/> + <video> + <br/> + PDF link."""
    content = read_file(path)

    # Pattern: <img src="URL" ... />\n\n<br/>\n\n<video ...>...</video>\n\n<br/>
    img_pattern = re.compile(
        r'<img\s+src="([^"]+)"[^>]*/>\s*\n\n'
        r'<br/>\s*\n\n'
        r'<video[^>]*>\s*\n'
        r'\s*<source[^>]*/>\s*\n'
        r'\s*Your browser does not support the video tag\.\s*\n'
        r'</video>\s*\n\n'
        r'<br/>',
        re.DOTALL
    )

    m = img_pattern.search(content)
    if m:
        img_url = m.group(1)
        embed = make_youtube_embed(video_id, img_url)
        new_content = content[:m.start()] + embed + '\n\n<br/>' + content[m.end():]
        write_file(path, new_content)
        return True
    else:
        print(f'WARNING: Type2 pattern not found in {path}')
        return False


# ============================================================
# Type 3: Already has YouTubeEmbed, just update videoId
# ============================================================

def update_type3(path, video_id):
    """Pages that already have YouTubeEmbed with wrong videoId."""
    content = read_file(path)
    new_content = re.sub(
        r'(<YouTubeEmbed\s+videoId=")[^"]+(")',
        rf'\g<1>{video_id}\2',
        content,
        count=1
    )
    if new_content != content:
        write_file(path, new_content)
        return True
    else:
        print(f'WARNING: No YouTubeEmbed found in {path}')
        return False


# ============================================================
# Type 4: No video, add YouTubeEmbed after main heading
# ============================================================

def update_type4(path, video_id):
    """Pages with no video. Add YouTubeEmbed after main # heading."""
    content = read_file(path)

    # Find the first # heading (may be after frontmatter)
    heading_pattern = re.compile(r'^(# .+)$', re.MULTILINE)
    m = heading_pattern.search(content)
    if m:
        embed = make_youtube_embed(video_id)
        insert_pos = m.end()
        new_content = content[:insert_pos] + '\n\n' + embed + '\n' + content[insert_pos:]
        write_file(path, new_content)
        return True
    else:
        print(f'WARNING: No main heading found in {path}')
        return False


# ============================================================
# Type 5: Module pages - add YouTubeEmbed + PDF after heading
# ============================================================

def update_type5(path, video_id, img_name, pdf_name):
    """Module pages: add YouTubeEmbed with GCS thumbnail + PDF link after heading."""
    content = read_file(path)

    img_url = f'{GCS_BASE}/modules/{img_name}'
    pdf_url = f'{GCS_BASE}/modules/{pdf_name}' if pdf_name else None

    embed = make_youtube_embed(video_id, img_url)

    if pdf_name:
        insert_block = f'\n\n{embed}\n\n<br/>\n\n{make_pdf_link(pdf_url)}\n'
    else:
        insert_block = f'\n\n{embed}\n'

    # Find the first # heading (may be after frontmatter)
    heading_pattern = re.compile(r'^(# .+)$', re.MULTILINE)
    m = heading_pattern.search(content)
    if m:
        insert_pos = m.end()
        new_content = content[:insert_pos] + insert_block + content[insert_pos:]
        write_file(path, new_content)
        return True
    else:
        print(f'WARNING: No main heading found in {path}')
        return False


# ============================================================
# Execute all updates
# ============================================================

def p(relative_path):
    return os.path.join(BASE_DIR, relative_path)


# --- Type 1: Workflow pages (img + video, no PDF) ---
type1_updates = [
    ('docs/workflows/agent.md',   'dP3jBocmh4k'),
    ('docs/workflows/finance.md', '8afdUHzCNwg'),
    ('docs/workflows/admin.md',   'l-mKpdHP-1M'),
    ('docs/workflows/partner.md', 'BpX2epB2E0A'),
    ('docs/workflows/user.md',    'hvoDQYJ8PuY'),
    ('docs/workflows/support.md', 'l-mKpdHP-1M'),
    ('docs/guides/agent.md',      '2R4Ek8airqI'),
    ('docs/guides/finance.md',    'vVRLTTaOBto'),
    ('docs/guides/user.md',       '9_SMSMTrcsY'),
    ('docs/guides/partner.md',    'TMfX7T_z3bk'),
    ('docs/guides/support.md',    '7EkWYQRPeAw'),
    ('docs/guides/admin.md',      'liLKCihI8vg'),
]

# using-rad has a PDF link too but still has img + video pattern
# Handle separately since it also has a PDF link after the video
def update_using_rad():
    path = p('docs/workflows/using-rad.md')
    content = read_file(path)
    # The pattern: <img ...> \n\n <video ...> ... </video>
    img_pattern = re.compile(
        r'<img\s+src="([^"]+)"[^>]*/>\s*\n\n'
        r'<video[^>]*>\s*\n'
        r'\s*<source[^>]*/>\s*\n'
        r'\s*Your browser does not support the video tag\.\s*\n'
        r'</video>',
        re.DOTALL
    )
    m = img_pattern.search(content)
    if m:
        img_url = m.group(1)
        embed = make_youtube_embed('U4oU0Z8jH3Q', img_url)
        new_content = content[:m.start()] + embed + content[m.end():]
        write_file(path, new_content)
    else:
        print(f'WARNING: Pattern not found in using-rad.md')


for rel_path, vid_id in type1_updates:
    update_type1(p(rel_path), vid_id)

update_using_rad()

# --- Type 2: Features pages (img + br + video + br, with PDF link) ---
type2_updates = [
    ('docs/features/admin.md',   'TBcmvRejXDo'),
    ('docs/features/agent.md',   'CLPC90yiUtA'),
    ('docs/features/support.md', 'KicTHugSGi0'),
    ('docs/features/finance.md', 'q8sTfyWm9c8'),
    ('docs/features/user.md',    'MFWoEOnCcSs'),
    ('docs/features/partner.md', 'c9zOpDELZ2c'),
]

for rel_path, vid_id in type2_updates:
    update_type2(p(rel_path), vid_id)

# --- Type 3: Already has YouTubeEmbed with wrong videoId ---
update_type3(p('docs/workflows/rad-benefits.md'), 'U4oU0Z8jH3Q')

# --- Type 4: No video, add YouTubeEmbed after heading ---
type4_updates = [
    ('docs/workflows/credits.md',       'KcVygBU4tfc'),
    ('docs/tutorials/getting-started.md', '_T008Avk7o0'),
    ('docs/tutorials/admin.md',         'Cn54xF-P0Go'),
    ('docs/tutorials/partner.md',       '4EyLflZFXQc'),
    ('docs/tutorials/user.md',          'Gxo4EuwmLcU'),
    ('docs/tutorials/agent.md',         'pb10lSy5nR0'),
    ('docs/tutorials/finance.md',       'zxaCgdLDKl0'),
    ('docs/tutorials/support.md',       'i2fpN6jryy4'),
    ('docs/tutorials/roi.md',           'UoKmb0znHzA'),
]

for rel_path, vid_id in type4_updates:
    update_type4(p(rel_path), vid_id)

# --- Type 5: Module pages ---
# (path, youtube_id, gcs_img_name, gcs_pdf_name or None)
type5_updates = [
    # Platform Modules
    ('docs/modules/AKS_GKE/AKS_GKE.md',         'a_o79iS9CO4',  'AKS_GKE.png',         'AKS_GKE.pdf'),
    ('docs/modules/EKS_GKE/EKS_GKE.md',          'VGko2SaLDZE',  'EKS_GKE.png',         None),  # no PDF in GCS
    ('docs/modules/Bank_GKE/Bank_GKE.md',         'ybbAakgQdKA',  'Bank_GKE.png',        'Bank_GKE.pdf'),
    ('docs/modules/Istio_GKE/Istio_GKE.md',       'xBcB4IG23uY',  'Istio_GKE.png',       'Istio_GKE.pdf'),
    ('docs/modules/MC_Bank_GKE/MC_Bank_GKE.md',   'z1tJ16izvpY',  'MC_Bank_GKE.png',     'MC_Bank_GKE.pdf'),
    ('docs/modules/VMware_Engine/VMware_Engine.md','jTtmQW5AlL0',  'VMWare_Engine.png',   'VMWare_Engine.pdf'),
    ('docs/modules/GCP_Services/GCP_Services.md', 'AbseyUBpOqM',  'Services_GCP.png',    'Services_GCP.pdf'),
    # Partner Modules
    ('docs/modules/Activepieces_CloudRun/Activepieces_CloudRun.md', 'xQaML_1zyec', 'Activepieces_CloudRun.png', 'Activepieces_CloudRun.pdf'),
    ('docs/modules/Activepieces_GKE/Activepieces_GKE.md',           'qOKaRxOB3UA', 'Activepieces_GKE.png',      'Activepieces_GKE.pdf'),
    ('docs/modules/App_CloudRun/App_CloudRun.md',                    'fiwpG-QdwXU', 'App_CloudRun.png',          'App_CloudRun.pdf'),
    ('docs/modules/App_GKE/App_GKE.md',                             'AYqSW6rJUAY', 'App_GKE.png',               'App_GKE.pdf'),
    ('docs/modules/Cyclos_CloudRun/Cyclos_CloudRun.md',              'WPECSqrQnzw', 'Cyclos_CloudRun.png',       'Cyclos_CloudRun.pdf'),
    ('docs/modules/Cyclos_GKE/Cyclos_GKE.md',                       'gtl8PJnIZ48', 'Cyclos_GKE.png',            'Cyclos_GKE.pdf'),
    ('docs/modules/Directus_CloudRun/Directus_CloudRun.md',          'hoQxO5K-Els', 'Directus_CloudRun.png',     'Directus_CloudRun.pdf'),
    ('docs/modules/Directus_GKE/Directus_GKE.md',                   'bY_QvUBz9W8', 'Directus_GKE.png',          'Directus_GKE.pdf'),
    ('docs/modules/Django_CloudRun/Django_CloudRun.md',              'cayP_zxYRbg', 'Django_CloudRun.png',       'Django_CloudRun.pdf'),
    ('docs/modules/Django_GKE/Django_GKE.md',                       'bY_QvUBz9W8', 'Django_GKE.png',            'Django_GKE.pdf'),
    # Elasticsearch_GKE skipped - no YouTube URL provided
    ('docs/modules/Flowise_CloudRun/Flowise_CloudRun.md',            'Him2xKb63hE', 'Flowise_CloudRun.png',      'Flowise_CloudRun.pdf'),
    ('docs/modules/Flowise_GKE/Flowise_GKE.md',                     'O0ZdeBnpuKA', 'Flowise_GKE.png',           'Flowise_GKE.pdf'),
    ('docs/modules/Ghost_CloudRun/Ghost_CloudRun.md',                'DHyeZ8q7xhU', 'Ghost_CloudRun.png',        'Ghost_CloudRun.pdf'),
    ('docs/modules/Ghost_GKE/Ghost_GKE.md',                         'oEhnrs_5PPE', 'Ghost_GKE.png',             'Ghost_GKE.pdf'),
    ('docs/modules/Kestra_CloudRun/Kestra_CloudRun.md',              'qGjdB4rxSGQ', 'Kestra_CloudRun.png',       'Kestra_CloudRun.pdf'),
    ('docs/modules/Kestra_GKE/Kestra_GKE.md',                       'LIA0OHMv8MQ', 'Kestra_GKE.png',            'Kestra_GKE.pdf'),
    ('docs/modules/Moodle_CloudRun/Moodle_CloudRun.md',              'OaymmxOTJps', 'Moodle_CloudRun.png',       'Moodle_CloudRun.pdf'),
    ('docs/modules/Moodle_GKE/Moodle_GKE.md',                       'm9pdsCMhhd8', 'Moodle_GKE.png',            'Moodle_GKE.pdf'),
    ('docs/modules/N8N_CloudRun/N8N_CloudRun.md',                    'Aez900at3EU', 'N8N_CloudRun.png',          'N8N_CloudRun.pdf'),
    ('docs/modules/N8N_GKE/N8N_GKE.md',                             'K1AxLa1xMP0', 'N8N_GKE.png',               'N8N_GKE.pdf'),
    ('docs/modules/N8N_AI_CloudRun/N8N_AI_CloudRun.md',              'VaplhsAOazI', 'N8N_AI_CloudRun.png',       'N8N_AI_CloudRun.pdf'),
    ('docs/modules/N8N_AI_GKE/N8N_AI_GKE.md',                       'DSUTweOEKBo', 'N8N_AI_GKE.png',            'N8N_AI_GKE.pdf'),
    ('docs/modules/NodeRED_CloudRun/NodeRED_CloudRun.md',            'PighVjgAzuw', 'NodeRed_CloudRun.png',      'NodeRed_CloudRun.pdf'),
    ('docs/modules/NodeRED_GKE/NodeRED_GKE.md',                     'uluvGXNPkbE', 'NodeRed_GKE.png',           'NodeRed_GKE.pdf'),
    # Odoo_CloudRun skipped - no YouTube URL provided
    ('docs/modules/Odoo_GKE/Odoo_GKE.md',                           'cAChBJgmmLI', 'Odoo_GKE.png',              'Odoo_GKE.pdf'),
    ('docs/modules/Ollama_CloudRun/Ollama_CloudRun.md',              'Uu_1bO4NLsI', 'Ollama_CloudRun.png',       'Ollama_CloudRun.pdf'),
    ('docs/modules/Ollama_GKE/Ollama_GKE.md',                       'F2OWLTuUntk', 'Ollama_GKE.png',            'Ollama_GKE.pdf'),
    ('docs/modules/OpenClaw_CloudRun/OpenClaw_CloudRun.md',          'Uu_1bO4NLsI', 'OpenClaw_CloudRun.png',     'OpenClaw_CloudRun.pdf'),
    ('docs/modules/OpenClaw_GKE/OpenClaw_GKE.md',                   'bdwW1VbvuBM', 'OpenClaw_GKE.png',          'OpenClaw_GKE.pdf'),
    ('docs/modules/OpenEMR_CloudRun/OpenEMR_CloudRun.md',            'PMHV80I67yc', 'OpenEMR_CloudRun.png',      'OpenEMR_CloudRun.pdf'),
    ('docs/modules/OpenEMR_GKE/OpenEMR_GKE.md',                     'xPCDmeESfCU', 'OpenEMR_GKE.png',           'OpenEMR_GKE.pdf'),
    ('docs/modules/RAGFlow_CloudRun/RAGFlow_CloudRun.md',            'wfMeu3xhZQQ', 'RAGFlow_CloudRun.png',      'RAGFlow_CloudRun.pdf'),
    ('docs/modules/RAGFlow_GKE/RAGFlow_GKE.md',                     '_nyxsxS_XCU', 'RAGFlow_GKE.png',           'RAGFlow_GKE.pdf'),
    ('docs/modules/Sample_CloudRun/Sample_CloudRun.md',              'HML16p56zA4', 'Sample_CloudRun.png',       'Sample_CloudRun.pdf'),
    ('docs/modules/Sample_GKE/Sample_GKE.md',                       'JtRvXXiwIdw', 'Sample_GKE.png',            'Sample_GKE.pdf'),
    ('docs/modules/Strapi_CloudRun/Strapi_CloudRun.md',              'vXFwcJG7cJE', 'Strapi_CloudRun.png',       'Strapi_CloudRun.pdf'),
    ('docs/modules/Strapi_GKE/Strapi_GKE.md',                       'nM1rc2ppKS4', 'Strapi_GKE.png',            'Strapi_GKE.pdf'),
    ('docs/modules/Temporal_GKE/Temporal_GKE.md',                   'CEXjd3vg9vE', 'Temporal_GKE.png',          'Temporal_GKE.pdf'),
    ('docs/modules/Wikijs_CloudRun/Wikijs_CloudRun.md',              'XpWRyS4o48o', 'Wikijs_CloudRun.png',       'Wikijs_CloudRun.pdf'),
    ('docs/modules/Wikijs_GKE/Wikijs_GKE.md',                       'g438Xuax57s', 'Wikijs_GKE.png',            'Wikijs_GKE.pdf'),
    ('docs/modules/Wordpress_CloudRun/Wordpress_CloudRun.md',        '-8LVMoWDoZ0', 'Wordpress_CloudRun.png',   'WordPress_CloudRun.pdf'),
    ('docs/modules/Wordpress_GKE/Wordpress_GKE.md',                  'D53ep0Eb6IU', 'Wordpress_GKE.png',         'WordPress_GKE.pdf'),
]

for rel_path, vid_id, img_name, pdf_name in type5_updates:
    update_type5(p(rel_path), vid_id, img_name, pdf_name)

print('\nDone!')
