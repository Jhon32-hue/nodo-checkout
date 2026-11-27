variable "project" {
  description = "Neutral resource prefix; must remain stable after deployment."
  type        = string
  default     = "nodo-checkout-demo"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,23}$", var.project))
    error_message = "Use 3-24 lowercase letters, digits or hyphens."
  }
}

variable "image_tag" {
  description = "Immutable ECR tag to install before starting any task. No floating latest tag."
  type        = string
  default     = "initial"
  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.image_tag)) && var.image_tag != "latest"
    error_message = "Choose a valid immutable tag other than latest."
  }
}

variable "desired_count" {
  description = "Keep zero until image, secrets, explicit migration and seed are ready."
  type        = number
  default     = 0
  validation {
    condition     = contains([0, 1], var.desired_count)
    error_message = "This assessment permits zero or one service task."
  }
}
