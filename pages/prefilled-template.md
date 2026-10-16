---
title: Pre-filled Template
sidebar_link: false
---

A test page, not linked from the rest of the site. It builds the upload template with a row already in it for each of the <Value data={herd_size} column=animals fmt=num0 /> animals on the ranch.

Say what you did and when, and you get the template back with every animal's tag, breed, type and location filled in. Delete the rows for animals you did not work, fill in anything left blank (a weight, for instance), then upload the file in step 2. Every row left in the file is saved as an event, so remove the ones that do not apply.

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
