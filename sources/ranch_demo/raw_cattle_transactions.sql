select t.*
from ranch_demo.cattle_transactions t
left join ranch_demo.upload_batches b on b.batch_id = t.batch_id
where b.voided is not true
