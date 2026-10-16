---
title: Add Events to the Data
sidebar_position: 5
---

Download a prefilled or blank template to add events to the data. The ranch currently has <Value data={herd_size} column=animals fmt=num0 /> animals.

## Options to download

- **Something happened to animals already on the ranch** (a vaccination, a weighing, a pregnancy check, a sale): you get a row for every animal, with its tag, breed, type and location filled in.
- **Calves were born:** you get a row for each pregnant cow, with her tag in the mother column, the calf's breed and location copied from her, and the birth year filled in. You add each calf's tag.
- **You bought animals:** say how many, and you get that many empty rows plus a Transactions row ready for the price. List no tags on the Transactions row and it covers every purchase dated that day.

**Delete the rows that do not apply**, fill in anything left blank (a weight, for instance), then upload the file in step 2. Every row left in the file is saved, so remove the ones you do not want.

All templates include a tab with a list of the current herd. This is for reference only and will not be picked up when your filled-in template is uploaded. Use it to add animals your filters may have missed.

This is a public demo, so please use made-up data. Uploads are added to the shared herd and are removed on a weekly basis.

## 1. Get the pre-filled template

<TemplateForm />

Need a blank template instead? <a href="/ranch-demo/cattle_upload_template.xlsx" download data-sveltekit-reload style="color:#3d6642;font-weight:600;text-decoration:underline">Download it here</a>.

## 2. Upload it

<UploadForm />

Dashboards update about 2 to 3 minutes after a successful upload.

<!-- Queries go at the bottom of the page. A page with no query at all gets no data file, and
     the site then fails while loading it. -->
```sql herd_size
select count(*) as animals from raw_current_cattle
```
