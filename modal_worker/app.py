"""Dormant Modal app definition.

This module intentionally declares no Modal Functions, Images, Secrets, Volumes,
or schedules. Importing it is safe and does not create remote resources. The
KataGo runtime will be added only when its cost and scaling policy are approved.
"""

import modal

from .settings import APP_NAME


app = modal.App(APP_NAME)
