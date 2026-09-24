# PROTOTYPE — extract-interpelli (throwaway)

**Question** ([What we extract from each interpello, and how](https://github.com/emossa/interpels/issues/5)):
what can we reliably pull out of an interpello's heading on the two Bari sources, and where must we fall back to the document?

- `node fetch.mjs`: downloads the national Decreti page, the uspbari WordPress posts and the ISTAT comuni CSV into `data/` (gitignored)
- `node tui.mjs`: hit rates plus a browser over misses and recipient matches
- `node pdf-sample.mjs 20`: province recovery from the PDF/ZIP when the heading has none
- `node ocr-sample.mjs`: the same for scanned PDFs, via OCR

`extract.mjs` is the pure logic, worth lifting into the real app. Everything else is throwaway.
The verdict is in the resolution comment on the ticket.
