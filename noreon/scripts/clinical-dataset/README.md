# Clinical dialogue dataset extraction

`docs/reference/clinical-dialogue-dataset-v2.0-hy.json` is extracted from Armen's PDF
(`docs/reference/clinical-dialogue-dataset-v2.0-hy.pdf`, 100 scenarios, Armenian) with PyMuPDF.
pdftotext is not usable here: it drops the Armenian "ու" ligature glyphs out of their words.

```bash
python3 -m venv /tmp/ds-venv && /tmp/ds-venv/bin/pip install pymupdf
/tmp/ds-venv/bin/python -I extract-dialogue-dataset.py ../../docs/reference/clinical-dialogue-dataset-v2.0-hy.pdf /tmp/ds.json
python3 augment-dialogue-dataset.py /tmp/ds.json ../../docs/reference/clinical-dialogue-dataset-v2.0-hy.json
```

The Armenian text is verbatim. `meta.safetyRules[].en` and `meta.urgencyTaxonomy.*.en` are English glosses for graders;
the Armenian is authoritative. The eval that uses it: `lib/zoe/eval/armen-dataset.ts`, `scripts/zoe-armen-eval.ts`.
