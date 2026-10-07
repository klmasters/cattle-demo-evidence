select e.*
from ranch_demo.cattle_events e
left join ranch_demo.upload_batches b on b.batch_id = e.batch_id
where b.voided is not true
