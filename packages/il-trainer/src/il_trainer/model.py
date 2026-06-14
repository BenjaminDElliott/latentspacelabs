"""
Neural network model for the Imitation Learning agent.

A lightweight feedforward network that maps agent states to action
probabilities. Inspired by the power grid IL approach: the model
takes a state vector and predicts the most effective action.

Key design decisions for fast CPU training and small model size:
- Shallow network (2 hidden layers, 128 units)
- No attention or recurrent layers
- Direct state -> action mapping (no latent space encoder)
- Uses ReLU activations with dropout for regularization

The state encoding (32 features) comes from feature_extraction.py:
- Agent state features (RunState, CheckOutcome, policy verdict)
- Context features (ticket metadata, cost band, risk level)
- Trajectory features (step number, cumulative reward signal)
"""

from __future__ import annotations

import math
import torch
import torch.nn as nn


# Global constants matching config
NUM_ACTION_CLASSES = 8
"""Discrete action classes the model predicts."""

STATE_DIM = 32
"""Input state vector dimension (after feature extraction)."""

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


class IlAgentModel(nn.Module):
    """
    Imitation Learning agent model.

    Maps agent state vectors to action probability distributions
    via a small feedforward network. Trained with cross-entropy
    loss on expert trajectories.

    Architecture (configurable via ILConfig):
        State (32) -> Linear -> ReLU -> Dropout -> Linear -> ReLU ->
        Dropout -> Linear (action_dim)

    Model size with default config:
        - State dim: 32, hidden: 128, layers: 2, action_dim: 8
        - Parameters: ~10.5K total
        - Size: ~40 KB (float32), ~120 KB (.pt file with metadata)
        - Well under the 50 MB constraint.
    """

    def __init__(
        self,
        state_dim: int = STATE_DIM,
        hidden_dim: int = 128,
        num_layers: int = 2,
        action_dim: int = NUM_ACTION_CLASSES,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.state_dim = state_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.action_dim = action_dim

        layers: list[nn.Module] = []
        prev_dim = state_dim

        for i in range(num_layers):
            layers.append(nn.Linear(prev_dim, hidden_dim))
            layers.append(nn.ReLU())
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev_dim = hidden_dim

        layers.append(nn.Linear(prev_dim, action_dim))
        # No activation on final layer; CrossEntropyLoss expects raw logits

        self.network = nn.Sequential(*layers)
        self._init_weights()

    def _init_weights(self) -> None:
        """Kaiming uniform initialization for linear layers."""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.kaiming_uniform_(
                    module.weight, mode="fan_in", nonlinearity="relu"
                )
                if module.bias is not None:
                    fan_in, _ = nn.init._calculate_fan_in_and_fan_out(module.weight)
                    bound = 1 / math.sqrt(fan_in) if fan_in > 0 else 0
                    nn.init.uniform_(module.bias, -bound, bound)

    def forward(self, state: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.

        Args:
            state: Batch of state vectors, shape (batch, state_dim).

        Returns:
            Action logits, shape (batch, action_dim).
        """
        return self.network(state)

    def predict(self, state: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Get predicted action and confidence.

        Args:
            state: Single or batch of state vectors.

        Returns:
            (predicted_action_indices, confidence_scores)
        """
        logits = self.forward(state)
        probs = torch.softmax(logits, dim=-1)
        predicted = torch.argmax(probs, dim=-1)
        confidence = torch.max(probs, dim=-1).values
        return predicted, confidence

    def num_parameters(self) -> int:
        """Return the number of trainable parameters."""
        return sum(p.numel() for p in self.parameters())

    def state_size_bytes(self) -> int:
        """Return the size of model state dict in bytes (float32)."""
        total = 0
        for state in self.state_dict().values():
            total += state.numel() * state.element_size()
        return total


# Module-level aliases for config compatibility
action_dim = NUM_ACTION_CLASSES
state_dim = STATE_DIM
num_action_classes = NUM_ACTION_CLASSES
