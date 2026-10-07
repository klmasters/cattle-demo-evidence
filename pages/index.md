---
title: Cattle Herd Demo
---

```sql by_breed
select breed, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql total
select count(*) as animals from raw_current_cattle
```

<KMStats>
  <BigValue data={total} value=animals title="Active animals" />
</KMStats>

<KMBarChart data={by_breed} x=breed y=animals />
