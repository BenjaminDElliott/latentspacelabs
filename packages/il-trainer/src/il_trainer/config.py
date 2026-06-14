"""
Configuration for the IL trainer.

All hyperparameters tuned for fast CPU training (<1 hour) and small
model size (<50 MB). Inspired by the power grid IL paper's key insight
that agents learn primarily from the last successful step, so we need
very few epochs to converge.
"""

from __future__ import annotations

import dataclasses
import os
from typing import Optional


@dataclasses.dataclass
class ILConfig:
    """Configuration for the Imitation Learning trainer."""

    # --- Model architecture ---
    state_dim: int = 32
    """Dimension of the state embedding (after feature extraction)."""
    hidden_dim: int = 128
    """Hidden layer dimension. Keeps model small and fast to train."""
    num_layers: int = 2
    """Number of hidden layers. 2 is enough; power grid IL uses 1-2."""
    dropout: float = 0.1
    """Dropout rate for regularization."""

    # --- Action space ---
    num_action_classes: int = 8
    """
    Number of discrete action classes. Maps to:
      0: dispatch_ticket (normal)
      1: dispatch_ticket (dry_run)
      2: post_write_back
      3: run_retro
      4: evaluate_policy
      5: no_op
      6: escalate
      7: handoff_to_human
    """

    # --- Training hyperparameters ---
    epochs: int = 5
    """Number of training epochs. Power grid IL converges in ~3."""
    batch_size: int = 64
    """Mini-batch size for training."""
    learning_rate: float = 0.001
    """Learning rate. Adam optimizer with weight decay."""
    weight_decay: float = 1e-4
    """L2 weight decay for regularization."""
    warmup_steps: int = 100
    """Warmup steps for learning rate scheduler."""
    max_grad_norm: float = 1.0
    """Gradient clipping norm."""

    # --- Data ---
    sample_weight_mode: str = "success_based"
    """
    How to weight samples during training.
    'uniform': equal weight for all samples.
    'success_based': upweight samples from successful trajectories
      (inspired by power grid IL: learn primarily from last successful step).
    'class_balanced': balance across action classes.
    """
    test_split: float = 0.2
    """Fraction of data held out for testing."""
    seed: int = 42
    """Random seed for reproducibility."""

    # --- I/O ---
    model_save_path: str = "il_agent_model.pt"
    """Path to save the trained model."""
    data_dir: str = "data"
    """Directory containing LAT-328 training data."""

    # --- Training constraints ---
    max_train_time_seconds: float = 3600.0
    """Maximum training time in seconds (1 hour)."""
    max_model_size_mb: float = 50.0
    """Maximum model size in MB after serialization."""

    # --- Device ---
    device: str = "cpu"
    """Device to train on. Always 'cpu' for speed constraint."""

    def __post_init__(self) -> None:
        """Validate configuration."""
        if self.state_dim <= 0:
            raise ValueError("state_dim must be positive")
        if self.hidden_dim <= 0:
            raise ValueError("hidden_dim must be positive")
        if self.num_layers < 1:
            raise ValueError("num_layers must be >= 1")
        if not (0.0 <= self.dropout < 1.0):
            raise ValueError("dropout must be in [0, 1)")
        if self.num_action_classes < 2:
            raise ValueError("num_action_classes must be >= 2")
        if self.epochs < 1:
            raise ValueError("epochs must be >= 1")
        if self.batch_size < 1:
            raise ValueError("batch_size must be >= 1")
        if self.learning_rate <= 0:
            raise ValueError("learning_rate must be positive")
        if self.test_split < 0 or self.test_split >= 1:
            raise ValueError("test_split must be in [0, 1)")
        if self.max_train_time_seconds < 1:
            raise ValueError("max_train_time_seconds must be >= 1")
        if self.max_model_size_mb < 1:
            raise ValueError("max_model_size_mb must be >= 1")

    def to_dict(self) -> dict:
        """Serialize config to dict."""
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ILConfig":
        """Deserialize config from dict."""
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


# Pre-defined action class labels (must match model.action_labels)
ACTION_LABELS = [
    "dispatch_ticket",
    "dispatch_ticket_dry_run",
    "post_write_back",
    "run_retro",
    "evaluate_policy",
    "no_op",
    "escalate",
    "handoff_to_human",
]


def default_config() -> ILConfig:
    """Return the default configuration tuned for fast CPU training."""
    cfg = ILConfig()
    cfg.epochs = 5  # Power grid IL converges in ~3 epochs
    cfg.hidden_dim = 128  # Small hidden dim keeps model under 50MB
    cfg.batch_size = 64  # Reasonable batch for CPU training
    return cfg


def estimate_model_size_mb(config: Optional[ILConfig] = None) -> float:
    """
    Estimate model file size in MB given the config.

    Formula: total_parameters * 4 bytes (float32) / 1e6.
    This gives an upper bound; actual .pt files are larger due to metadata.
    """
    if config is None:
        config = default_config()

    total_params = 0
    prev_dim = config.state_dim
    for i in range(config.num_layers):
        curr_dim = config.hidden_dim
        total_params += prev_dim * curr_dim + curr_dim  # weights + biases
        prev_dim = curr_dim
    total_params += prev_dim * config.num_action_classes + config.num_action_classes

    # float32 = 4 bytes; add ~20% for .pt overhead (optimizer states, etc.)
    size_mb = total_params * 4 * 1.2 / 1e6
    return size_mb
