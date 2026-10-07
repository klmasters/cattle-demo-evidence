---
title: Animal Lookup
sidebar_position: 4
---

Pick a tag number to see one animal's whole record. This page reads every event on file, so animals that were sold or have died can be looked up too. The data is fake, generated for this demo.

```sql tags
select tag_number
from raw_cattle_events
group by 1
order by cast(tag_number as integer)
```

<Dropdown name=tag data={tags} value=tag_number title="Tag number" defaultValue="248" />

```sql animal
with latest as (
  select tag_number, event_type, location,
    row_number() over (order by event_date desc, id desc) as rn
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}'
),
info as (
  select any_value(breed) as breed, any_value(type) as type,
    cast(any_value(birth_year) as integer) as birth_year,
    any_value(mother_tag_number) as mother_tag
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}'
),
offspring as (
  select count(*) as calves
  from raw_cattle_events
  where event_type = 'birth' and mother_tag_number = '${inputs.tag.value}'
),
last_weight as (
  select weight_lbs
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}' and event_type = 'weight'
  order by event_date desc, id desc
  limit 1
)
select
  '${inputs.tag.value}' as tag,
  case l.event_type when 'sold' then 'Sold' when 'deceased' then 'Deceased' else 'Active' end as status,
  i.type, i.breed, l.location, i.birth_year, i.mother_tag, o.calves,
  w.weight_lbs as last_weight_lbs
from latest l
cross join info i
cross join offspring o
left join last_weight w on true
where l.rn = 1
```

```sql history
select
  cast(event_date as date) as event_date,
  event_type,
  notes,
  weight_lbs
from raw_cattle_events
where tag_number = '${inputs.tag.value}'
order by event_date, id
```

```sql event_counts
select event_type, count(*) as events
from raw_cattle_events
where tag_number = '${inputs.tag.value}'
group by 1
order by 2 desc, 1
```

```sql weights
select cast(event_date as date) as event_date, weight_lbs
from raw_cattle_events
where tag_number = '${inputs.tag.value}' and event_type = 'weight'
order by event_date, id
```

## Summary
<DataTable data={animal} rows=1>
  <Column id=tag title="Tag" />
  <Column id=status title="Status" />
  <Column id=type title="Type" />
  <Column id=breed title="Breed" />
  <Column id=location title="Location" />
  <Column id=birth_year title="Birth year" fmt="0" />
  <Column id=mother_tag title="Mother" />
  <Column id=calves title="Calves born" />
  <Column id=last_weight_lbs title="Last weight (lb)" fmt="#,##0" />
</DataTable>

Status comes from the animal's latest event: Sold or Deceased if that is the last thing recorded, otherwise Active. Mother is blank for animals that were on the ranch before records began or were bought.

## Event history
A birth and its birth weight are recorded on the same day, so a date can appear twice.

<DataTable data={history} rows=15>
  <Column id=event_date title="Date" fmt="yyyy-mm-dd" />
  <Column id=event_type title="Event" />
  <Column id=notes title="Notes" />
  <Column id=weight_lbs title="Weight (lb)" fmt="#,##0" />
</DataTable>

## Events by type
<KMBarChart data={event_counts} x=event_type y=events />

## Weight history
{#if weights.length > 0}

<KMLineChart data={weights} x=event_date y=weight_lbs markers=true xFmt="mmm d, yyyy" yFmt="#,##0" />

{:else}

No weights are on file for this animal. In this data only calves are weighed.

{/if}
