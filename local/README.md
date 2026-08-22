# Local n8n notes

Only import the two active workflow files in this fork:

- `workflows/workflow_a_intake.json`
- `workflows/workflow_b_delivery_twilio.json`

Copy `n8n.env.example` to the ignored `n8n.env` and fill it locally. Never run a local Workflow B while another instance points at the same Sheet: both schedulers could send the same due row.

The original adaptive project remains the recovery source for removed workflows.
