---
title: Pregnancy & Calving
sidebar_position: 2
---

Pregnancy checks happen each fall and calving runs from January to April. The data is fake, generated for this demo.

```sql currently_pregnant
with last_check as (
  select tag_number, max(cast(event_date as date)) as check_date
  from raw_cattle_events
  where event_type = 'pregnant'
  group by 1
),
last_birth as (
  select mother_tag_number, max(cast(event_date as date)) as birth_date
  from raw_cattle_events
  where event_type = 'birth'
  group by 1
)
select count(*) as cows
from last_check c
join raw_current_cattle a on a.tag_number = c.tag_number
left join last_birth b on b.mother_tag_number = c.tag_number
where b.birth_date is null or b.birth_date < c.check_date
```

```sql due_by_month
select
  strftime(cast(estimated_due_month as date), '%b %Y') as due_month,
  cast(estimated_due_month as date) as due_date,
  count(*) as cows
from raw_cattle_events
where event_type = 'pregnant'
group by 1, 2
order by 2
```

```sql confirmed_by_month
select
  strftime(cast(event_date as date), '%b %Y') as checked_month,
  date_trunc('month', cast(event_date as date)) as checked_date,
  count(*) as cows
from raw_cattle_events
where event_type = 'pregnant'
group by 1, 2
order by 2
```

```sql births_by_year
select cast(year(cast(event_date as date)) as varchar) as year, count(*) as calves
from raw_cattle_events
where event_type = 'birth'
group by 1
order by 1
```

```sql births_by_month
select
  month(cast(event_date as date)) as month_num,
  strftime(cast(event_date as date), '%b') as month,
  count(*) as calves
from raw_cattle_events
where event_type = 'birth'
group by 1, 2
order by 1
```

```sql calf_mother
select
  tag_number as calf_tag,
  mother_tag_number as mother_tag,
  cast(event_date as date) as birth_date
from raw_cattle_events
where event_type = 'birth'
order by event_date desc, tag_number
```

<KMStats>
  <BigValue data={currently_pregnant} value=cows title="Currently pregnant" />
</KMStats>

Currently pregnant means a cow still on the ranch whose latest pregnancy check has no birth after it. Calving is over by May, so this reads zero until the next fall's checks are added.

## Pregnancies

### Expected due dates by month
Every pregnancy check on record, grouped by the month the calf was due.

<KMBarChart data={due_by_month} x=due_month y=cows sort=false />

### Pregnancies confirmed by month
<KMBarChart data={confirmed_by_month} x=checked_month y=cows sort=false />

## Calving

### Calves born by year
<KMBarChart data={births_by_year} x=year y=calves />

### Calves born by month, all years
<KMBarChart data={births_by_month} x=month y=calves sort=false />

### Calf to mother
<DataTable data={calf_mother} rows=10 search=true>
  <Column id=calf_tag title="Calf tag" />
  <Column id=mother_tag title="Mother tag" />
  <Column id=birth_date title="Birth date" fmt="yyyy-mm-dd" />
</DataTable>
