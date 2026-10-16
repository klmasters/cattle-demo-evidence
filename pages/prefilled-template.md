---
title: Pre-filled Template
sidebar_link: false
---

A test page, not linked from the rest of the site. It builds the upload template with the rows already started, so you only type what is new. The ranch currently has <Value data={herd_size} column=animals fmt=num0 /> animals.

- **Something happened to animals already on the ranch** (a vaccination, a weighing, a pregnancy check, a sale): you get a row for every animal, with its tag, breed, type and location filled in.
- **Calves were born:** you get a row for each mother, with her tag in the mother column, the calf's breed and location copied from her, and the birth year filled in. You add each calf's tag.
- **You bought animals:** say how many, and you get that many empty rows plus a Transactions row ready for the price. List no tags on the Transactions row and it covers every purchase dated that day.

Delete the rows that do not apply, fill in anything left blank (a weight, for instance), then upload the file in step 2. Every row left in the file is saved, so remove the ones you do not want.

This is a public demo, so please use made-up data. Uploads are added to the shared herd and can be removed at any time.

## 1. Get the pre-filled template

<TemplateForm noindex />

Need a blank template instead? <a href="/ranch-demo/cattle_upload_template.xlsx" download data-sveltekit-reload style="color:#3d6642;font-weight:600;text-decoration:underline">Download it here</a>.

## 2. Upload it

<UploadForm />

Dashboards update within a few minutes of a successful upload.

<!-- Queries go at the bottom of the page. A page with no query at all gets no data file, and
     the site then fails while loading it. -->
```sql herd_size
select count(*) as animals from raw_current_cattle
```
