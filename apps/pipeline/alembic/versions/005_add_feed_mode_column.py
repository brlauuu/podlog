"""Add mode column to feeds (test | full)

Revision ID: 005
Revises: 004
Create Date: 2026-03-16

Per issue #23: TEST podcast mode — sample 5 episodes before committing to full ingestion.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('feeds', sa.Column('mode', sa.Text(), nullable=False, server_default='full'))
    op.create_index('ix_feeds_mode', 'feeds', ['mode'])


def downgrade() -> None:
    op.drop_index('ix_feeds_mode', table_name='feeds')
    op.drop_column('feeds', 'mode')
