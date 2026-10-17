---
title: Pregnancy & Calving
sidebar_position: 2
dev_only: true
---

Pregnancy checks happen each October and calving runs from January to April. The data is fake, generated for this demo.

<div class="km-split">
  <BigValue data={currently_pregnant} value=cows title="Currently pregnant" />
  <KMBarChart data={due_by_month} x=due_month y=cows sort=false title="Expected due dates by month" />
</div>

### Pregnancy checks by year
<KMBarChart data={checks_by_year} x=year y=cows series=result type=stacked sort=false />

### Calves born
<Grid cols=2>
  <KMBarChart data={born_by_year} x=year y=calves sort=false title="By year" />
  <KMBarChart data={born_by_month} x=birth_month y=calves sort=false title="By month, all years" />
</Grid>

### Calf to mother
<DataTable data={calf_mother} rows=10 search=true>
  <Column id=calf_tag title="Calf tag" />
  <Column id=mother_tag title="Mother tag" />
  <Column id=birth_date title="Birth date" fmt="yyyy-mm-dd" />
  <Column id=birth_weight_lbs title="Birth weight (lb)" />
</DataTable>

<!-- Queries: kept at the bottom so the page layout reads top to bottom. -->

```sql currently_pregnant
select count(*) as cows
from raw_current_cattle
where currently_pregnant
```

```sql due_by_month
-- Due date = check date minus the months pregnant (30.4 days each), plus a 283-day gestation.
-- Each current cow counts once, from her latest pregnancy check.
with latest_check as (
  select
    tag_number,
    arg_max(
      cast(event_date as date) - cast(round(estimated_months_pregnant * 30.4) as integer) + 283,
      cast(event_date as date)
    ) as due_date
  from raw_cattle_events
  where notes ilike '%preg check%' and estimated_months_pregnant is not null
  group by 1
)
select
  strftime(date_trunc('month', due_date), '%b %Y') as due_month,
  date_trunc('month', due_date) as due_start,
  count(*) as cows
from latest_check
where tag_number in (select tag_number from raw_current_cattle where currently_pregnant)
group by 1, 2
order by 2
```

```sql checks_by_year
-- Every cow checked, including ones later culled. An open cow has no months pregnant.
select
  cast(year(event_date) as varchar) as year,
  case when estimated_months_pregnant is null then 'Open' else 'Pregnant' end as result,
  count(*) as cows
from raw_cattle_events
where notes ilike '%preg check%'
group by 1, 2
order by 1, 2 desc
```

```sql born_by_year
select cast(year(event_date) as varchar) as year, count(*) as calves
from raw_cattle_events
where event_type = 'birth'
group by 1
order by 1
```

```sql born_by_month
select
  strftime(make_date(2000, month(event_date), 1), '%b') as birth_month,
  month(event_date) as month_number,
  count(*) as calves
from raw_cattle_events
where event_type = 'birth'
group by 1, 2
order by 2
```

```sql calf_mother
-- Calves of cows still on the ranch.
select
  tag_number as calf_tag,
  mother_tag_number as mother_tag,
  cast(event_date as date) as birth_date,
  weight_lbs as birth_weight_lbs
from raw_cattle_events
where event_type = 'birth'
  and mother_tag_number in (select tag_number from raw_current_cattle)
order by event_date desc, tag_number
```
