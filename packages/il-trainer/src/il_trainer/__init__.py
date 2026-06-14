"""
IL Trainer for Hermes Agent — Imitation Learning from agent trajectories.

Maps agent states to effective actions using a lightweight neural network,
inspired by the power grid IL approach (3 epochs vs 900 SAC steps, 97.9%
solve rate). Trains in <1 hour on CPU and produces models <50 MB.

Designed to consume data from LAT-328 (training data collector).
"""

from .config import ILConfig, default_config
from .dataset import TrajectoryDataset, load_lat328_data, TrajectorySample
from .model import IlAgentModel, state_dim, action_dim, num_action_classes
from .trainer import ILTrainer
from .inference import IlPredictor

__all__ = [
    "ILConfig",
    "default_config",
    "TrajectoryDataset",
    "TrajectorySample",
    "load_lat328_data",
    "IlAgentModel",
    "state_dim",
    "action_dim",
    "num_action_classes",
    "ILTrainer",
    "IlPredictor",
]
