"""Persist observed runs and immutable evaluation snapshots."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "20261028_0002"
down_revision = "20261026_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("observed_runs",
        sa.Column("id", sa.String(160), primary_key=True),
        sa.Column("trace_id", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_observed_runs_trace_id", "observed_runs", ["trace_id"], unique=True)
    for column in ("kind", "status", "created_at"):
        op.create_index(f"ix_observed_runs_{column}", "observed_runs", [column])
    op.create_table("evaluation_datasets",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(60), unique=True, nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_table("evaluation_cases",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("source_run_id", sa.String(160), nullable=False),
        sa.Column("source_trace_id", sa.String(160), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("label", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("expected_answer", sa.Text, nullable=False),
        sa.Column("tags", JSONB, nullable=False),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("source_run_id", "source_trace_id", name="uq_evaluation_source"))
    op.create_table("evaluation_memberships",
        sa.Column("case_id", UUID, sa.ForeignKey("evaluation_cases.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("dataset_id", UUID, sa.ForeignKey("evaluation_datasets.id", ondelete="CASCADE"), primary_key=True))
    # Application whitelists plus a database guard protect source evidence from accidental edits.
    op.execute("""CREATE FUNCTION protect_case_evidence() RETURNS trigger AS $$
    BEGIN
      IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
        OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
        OR NEW.source_trace_id IS DISTINCT FROM OLD.source_trace_id THEN
        RAISE EXCEPTION 'evaluation source evidence is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql""")
    op.execute("CREATE TRIGGER evaluation_evidence_immutable BEFORE UPDATE ON evaluation_cases FOR EACH ROW EXECUTE FUNCTION protect_case_evidence()")


def downgrade():
    for name in ("evaluation_memberships", "evaluation_cases", "evaluation_datasets", "observed_runs"):
        op.drop_table(name)
    op.execute("DROP FUNCTION protect_case_evidence()")
