BU International Center Workspace V4.6
======================================

V4.6 — Source Integrity + Workflow Reliability

MAIN CHANGES
- Faculty & Major data was reconciled against the V4.5 official-source audit instead of treating every existing EN/TH label as officially exact.
- Confirmed source-backed Faculty/Major corrections are applied to the Excel master and bundled website snapshot.
- Faculty/Major cards now expose source status, record status, source context and source-backed wording when it differs from the short display label.
- Records that still require exact-source verification are visibly flagged instead of being presented as officially verified.
- Thai wording that cannot yet be proven from an exact BU source is labelled AI Translate.
- Legacy, intake-specific and transition records are distinguished from current records.
- Incomplete FM032 is inactive/hidden from normal search results.

CONFIRMED FACULTY / MAJOR CORRECTIONS APPLIED
- FM002 Business English — Thai wording corrected.
- FM005 Creative Communication Design — Thai wording corrected.
- FM007 Marketing (BUI) — Thai wording corrected.
- FM020 Broadcasting and Streaming Media Production — official spacing corrected.
- FM027 Tourism and Cruise Management — current Thai spelling/Unicode corrected.
- FM036 Business Chinese — Thai wording corrected.
- FM076 Master of Architecture (Architecture) — official Thai Master wording applied.
- FM077 Master of Architecture (Interior Architecture) — official Thai Master wording applied.
- FM078 Master of Architecture (Innovative Design and Management) — confirmed official Thai wording applied.
- FM083 Tourism and Hospitality Management Innovation Master — audited Thai wording applied.

REFERENCE SEARCH
- Recent Searches now hides correctly while results are active and is hidden when history is empty.
- Search result relevance order is preserved; layout no longer rearranges records after ranking.
- Overview counters are clickable: browse Countries, Faculty/Major, Embassy or all review-flagged records.
- Review overview shows a Country / Faculty / Embassy breakdown.
- Live suggestions are positioned below the topic tabs so tabs remain clickable.
- Header layout is simplified and tested at common office widths, including 1366 px.

COMMUNICATION
- Generated drafts now have two states: Generated and Modified.
- After the user manually edits the body or subject, automatic regeneration is paused for that edited field.
- Regenerate deliberately rebuilds the draft from the current student/message fields.
- Reset message clears message-specific fields while retaining the current student case.
- New student clears the full student case after confirmation.
- Missing placeholders are shown as clickable chips that jump to the required field.
- Mobile Communication topic panel is constrained again and no longer inherits the later desktop sticky/max-height rule.

DATA / EXCEL
- Excel remains the master database.
- Workbook import now validates required sheets, key columns, key IDs, YES/NO fields and orphan alias references before replacing the current data.
- Structural errors reject the import. Warnings require confirmation.
- Up to two previous successful Excel imports can be kept in browser storage and restored.
- V4.6 uses a new saved-data key so an older V4.x manually loaded workbook cannot silently override the new audited bundled data on first launch.
- The root Reference_Data.xlsx and data/Reference_Data.xlsx are synchronized copies.

WORKSPACE PAGES
1. Reference Search
   - Country & Nationality
   - Faculty & Major
   - Thai Embassy / Consular offices
2. Communication
   - Email generator
   - Chat reply generator
   - Document selector
   - Reusable student case information
   - Personal Signature Library
3. Student Documents
   - Create Number + Name folder
   - Copy one of five Word templates as Letter_Name.docx
4. Data
   - Download / reload the Excel master
   - Review current data status
   - Restore recent Excel imports

THEMES
- Light
- Dark
- Graphite Gray
- Purple Night
- Light Red-Blue
- Forest
- Warm Sand

BROWSER REQUIREMENTS
- Open index.html in Microsoft Edge or Google Chrome.
- Folder creation uses the File System Access API and requires user permission.
- Bundled reference data works offline.
- Importing a newly edited Excel workbook loads SheetJS from its CDN, so Excel import may require internet access.
- Web Source links naturally require internet access.

IMPORTANT DATA RULE
Do not assume a Faculty/Major translation is official merely because it appears in the workbook. V4.6 distinguishes exact/source-backed wording from wording that still needs source verification. When an exact BU source is available, preserve that source wording rather than normalizing or retranslating it.

See AUDIT_REPORT.txt for the V4.6 implementation and smoke-test report.

------------------------------------------------------------
WORD TEMPLATE MANAGER (Windows)
------------------------------------------------------------
To replace one of the five Word templates without manually editing Base64:

1. Extract the entire workspace ZIP to a normal folder.
2. Double-click: Update Word Template.bat
3. Choose the template to replace.
4. Browse to your updated .docx file.
5. Click "Replace Template" and confirm.

The Template Manager automatically:
- validates that the selected file is a Word .docx package;
- backs up the current DOCX and data/letter-templates.js in template-backups/<timestamp>/;
- replaces the selected file under /templates;
- updates the matching embedded Base64 entry in data/letter-templates.js;
- verifies that the embedded copy is byte-for-byte identical to the new DOCX.

If the website is already open, refresh the page after replacing a template.


V4.6.2 hotfix: Template Manager path handling was corrected for Windows WinForms event execution.

V4.6.3 UI cleanup: internal Faculty/Major source-audit metadata is retained in the workbook but hidden from normal search cards and floating reference windows to keep the operational interface concise.

V4.6.4 source-confidence update: the duplicate Program / Degree row is hidden from expanded Faculty/Major cards while Copy all remains unchanged. All 82 active Faculty/Major records were re-audited on 2026-08-31. Field-level red dots now identify values that are not confirmed as exact/source-backed; hover a dot for the reason. Faculty_Major now includes Faculty EN Source Status, Faculty TH Source Status, Reaudit Checked, and Reaudit Notes columns.

V4.6.5 AI-provenance update: the Faculty/Major red dot is now an AI-content indicator only, not a generic source-certification warning. A second pass across all 82 active Faculty/Major records resolved the conservative false positives from V4.6.4. Exact official sources were found for FM008, FM009, FM010 and FM021. FM037's previous AI-normalized Thai wording was replaced with official BU wording. As of the 2026-08-31 second-pass audit, no active Faculty/Major displayed field is marked as AI-created context; the red-dot mechanism remains available for future AI-generated/translated/inferred values.

V4.6.6 Thai mission directory update: the Embassy dataset is now reconciled to the official Thai Embassy and Consulates directory at https://www.thaiembassy.org/en/index. The bundled active mission list now matches the directory: 65 Royal Thai Embassies, 29 Royal Thai Consulates-General, 3 Permanent Missions, and 1 Thailand Trade and Economic Office (98 active directory entries). Three Permanent Missions were added. Supplementary honorary/non-directory offices remain preserved in Excel but are hidden from normal search. Existing row-specific official mission URLs are retained where available; otherwise the official directory is used as the source link. The browser data key was also bumped so older V4.6.x saved Excel data cannot silently override this updated bundled mission list.

V4.6.7 Faculty/Major import authority fix: Faculty EN and Major EN are now the authoritative editable Excel fields. The legacy Faculty EN Copy / Major EN Copy columns are fallback-only, so manual changes made to the primary fields appear immediately after importing the workbook. The four requested international-program labels are also included in the bundled workbook/snapshot.

V4.6.8 Excel maintenance cleanup: the legacy fallback columns Faculty EN Copy and Major EN Copy were renamed to (auto) Faculty EN Copy and (auto) Major EN Copy and hidden/collapsed in the bundled workbook. Users should edit Faculty EN and Major EN only. The website remains backward-compatible with older imported workbooks that still use the original Copy-column names.

V4.6.9 Student Documents template update: added Current No IEN as a fifth Word type. It is available in Create student folder and in Update Word Template.bat, with templates/Letter_Current_No_IEN.docx kept in sync with the embedded data/letter-templates.js copy.

V4.6.10 data and doctoral update: Reference_Data fix 123(1).xlsx is the new authoritative workbook base. All displayed Thai Major values now begin with 'สาขาวิชา'; Master's Thai Major values are normalized to major-only wording while original full program titles remain in hidden audit/source-backed fields. Four current doctoral programs were added from official Bangkok University sources with a Doctor filter in Faculty & Major search. Doctor Degree was added as a sixth Student Documents Word template and to Update Word Template.bat. Embassy display now prioritizes the original Embassy Information_2 source fields, using later official-directory reconciliation fields only as fallback; for example, Ho Chi Minh City remains 'Ho Chi Minh City' as in the original source. Browser data storage keys were bumped so older cached datasets do not override the new bundled data.


V4.6.12 source-priority update: Display wording now follows the field-level hierarchy requested by the user: (1) original Excel/Word source, (2) the main Bangkok University course/faculty directory or thaiembassy.org directory, then (3) other websites. The original source workbook สาขา 20260121(1).xlsx is preserved in the workbook and its values now override later website normalization when present. This restores source wording such as Innovative Media Production (International Program), Entrepreneurship (International Program), Culinary Arts and Design (International Program), Film, Series and Global Content Production and Business (International Program), and Communication and New Media. For records missing from the original source, the main BU site remains authoritative; for example Master of Engineering in Electrical & Computer Engineering (International Program). Embassy Information_2(2).docx remains the display priority for mission wording such as Ho Chi Minh City.
