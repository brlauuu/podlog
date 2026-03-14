"""Add processing duration columns to episodes

Revision ID: 003
Revises: 002
Create Date: 2026-03-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '003'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('episodes', sa.Column('transcribe_duration_secs', sa.Float(), nullable=True))
    op.add_column('episodes', sa.Column('diarize_duration_secs', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('episodes', 'diarize_duration_secs')
    op.drop_column('episodes', 'transcribe_duration_secs')
