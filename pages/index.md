---
title: Herd Overview
sidebar_position: 1
---

A snapshot of the herd as it stands now: every animal that has not been sold or died. The data is fake, generated for this demo.

```sql total
select count(*) as animals from raw_current_cattle
```

```sql by_breed
select breed, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql by_type
select type, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql by_location
select location, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql by_birth_year
select cast(cast(birth_year as integer) as varchar) as birth_year, count(*) as animals
from raw_current_cattle
group by 1
order by 1
```

```sql weight_by_month
select
  month(cast(event_date as date)) as month_num,
  strftime(cast(event_date as date), '%b') as month,
  round(avg(weight_lbs)) as avg_weight_lbs
from raw_cattle_events
where event_type = 'weight'
group by 1, 2
order by 1
```

```sql weight_by_breed
select breed, round(avg(weight_lbs)) as avg_weight_lbs
from raw_cattle_events
where event_type = 'weight'
  and month(cast(event_date as date)) = 10
group by 1
order by 2 desc
```

```sql weight_by_year
select
  cast(year(cast(event_date as date)) as varchar) as year,
  case
    when month(cast(event_date as date)) <= 4 then 'Birth (Jan-Apr)'
    when month(cast(event_date as date)) = 10 then 'October'
    else 'December'
  end as weigh_in,
  round(avg(weight_lbs)) as avg_weight_lbs
from raw_cattle_events
where event_type = 'weight'
group by 1, 2
order by 1, 2
```

<KMStats>
  <BigValue data={total} value=animals title="Active animals" />
</KMStats>

## Who is on the ranch

### By breed
<KMBarChart data={by_breed} x=breed y=animals />

### By type
Every breeding female is labeled Cow.

<KMBarChart data={by_type} x=type y=animals />

### By location
<KMBarChart data={by_location} x=location y=animals />

### By birth year
<KMBarChart data={by_birth_year} x=birth_year y=animals sort=false />

## Weights

Only calves are weighed in this data: at birth (January to April), in October and in December. Cows and bulls have no weights, so these charts cover calves only.

### Average calf weight by month weighed
<KMBarChart data={weight_by_month} x=month y=avg_weight_lbs sort=false yFmt="#,##0" />

### Average October weight by breed
<KMBarChart data={weight_by_breed} x=breed y=avg_weight_lbs yFmt="#,##0" />

### Average weight by year
<KMLineChart data={weight_by_year} x=year y=avg_weight_lbs series=weigh_in yFmt="#,##0" />
