"""Add inference columns to episodes and speaker inference columns to speaker_names

Revision ID: 002
Revises: 001
Create Date: 2026-03-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('episodes', sa.Column('inference_skipped', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('episodes', sa.Column('inference_error', sa.Text(), nullable=True))
    op.add_column('speaker_names', sa.Column('inferred', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('speaker_names', sa.Column('confidence', sa.Text(), nullable=True))
    op.add_column('speaker_names', sa.Column('confirmed_by_user', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    op.drop_column('speaker_names', 'confirmed_by_user')
    op.drop_column('speaker_names', 'confidence')
    op.drop_column('speaker_names', 'inferred')
    op.drop_column('episodes', 'inference_error')
    op.drop_column('episodes', 'inference_skipped')
