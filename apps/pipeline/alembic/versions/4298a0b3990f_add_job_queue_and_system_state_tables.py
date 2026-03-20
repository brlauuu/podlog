"""add job_queue and system_state tables

Revision ID: 4298a0b3990f
Revises: 005
Create Date: 2026-03-20 07:39:45.576437

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4298a0b3990f'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('system_state',
        sa.Column('key', sa.Text(), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('key')
    )
    op.create_table('job_queue',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('episode_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('task', sa.Text(), nullable=False),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('picked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['episode_id'], ['episodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(
        'idx_job_queue_poll', 'job_queue',
        ['status', 'retry_at', 'created_at'],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_column('episodes', 'celery_task_id')


def downgrade() -> None:
    op.add_column('episodes', sa.Column('celery_task_id', sa.TEXT(), nullable=True))
    op.drop_index('idx_job_queue_poll', table_name='job_queue', postgresql_where=sa.text("status = 'pending'"))
    op.drop_table('job_queue')
    op.drop_table('system_state')
