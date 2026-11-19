INTERNATIONAL CENTER - NEW LETTER WORKSHOP EDITION
==================================================
Source: panachaialtman/buic-search-everything
Branch: workshop-new-visa-only-20261119
Scope: NEW VISA / NEW LETTER AND PDF CREATOR ONLY

This workshop edition retains the ORIGINAL source code and visual design of
the New Letter PDF Creator and its dependencies. Other workspace sections are
hidden. This is not a reimplementation of the editor.

STEPS
1. Download the GitHub ZIP for this branch.
2. Extract the ZIP into a normal folder.
3. Start a local server inside the extracted folder:
      python -m http.server 8000
4. Open http://localhost:8000 in Chrome or Microsoft Edge.
5. Open New Letter. Use fictional student data only.
6. In demo-pdfs/ are nine white A4 single-page sample PDFs:
      Front.pdf
      Back.pdf
      Passport.pdf
      Receipt.pdf
      Application.pdf
      Visa_Request.pdf
      Transcript_1.pdf
      Transcript_2.pdf
      Transcript_3.pdf
7. Import Passport, Receipt, Application, Visa_Request, and Transcripts
   through the PDF Creator. Import Front and Back as default assets if desired.
8. Review page order, crop, rotate, and export using the original controls.

IMPORTANT
- Student login and remote student database writes are DISABLED in this edition.
- Cross-department tools, Current Letter, PDF Combine, Communication, Reference
  Search, and Data are hidden from the interface (their sources are retained
  as dependencies/for source fidelity).
- The server-side document conflict check is simulated and NOT an official
  validation.
- No student data is fetched from the university.
- The original editor may need internet access to load PDF.js/JSZip dependencies.
- Use fictional data only and do not submit generated documents to Immigration.
- This is a workshop demonstration, not an AI-powered visa eligibility system.
- Original main branch is NOT modified.
