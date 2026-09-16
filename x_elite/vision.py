# Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
# SPDX-License-Identifier: BSD-3-Clause
"""Describe an image with a local GenieX vision-language model.

This uses the GenieX Python SDK directly (`geniex.AutoModelForCausalLM`),
which is a separate interface from the OpenAI-compatible `geniex serve`
endpoint that x_elite/client.py talks to. It does not require `geniex serve`
to be running - it loads the model in-process.

Requires a VL-capable model to be available, e.g.:
    geniex pull ai-hub-models/Qwen2.5-VL-7B-Instruct

Standalone:
    python -m x_elite.vision --image path/to/frame.jpg

As a library, to seed a scene description into the guarded chat loop,
pass the returned text as the `user_text` you'd normally type at the
"You: " prompt in x_elite.client.
"""

import argparse

from geniex import AutoModelForCausalLM

DEFAULT_VLM = "ai-hub-models/Qwen2.5-VL-7B-Instruct"
DEFAULT_PROMPT = "Describe the image, and note any board, LED, or hardware state you can see."


def describe_image(image_path: str, prompt: str = DEFAULT_PROMPT, model_name: str = DEFAULT_VLM) -> str:
    """Load a VLM, describe one image, then release the model."""
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map="qairt")
    try:
        messages = [{
            "role": "user",
            "content": [
                {"type": "image", "image": image_path},
                {"type": "text", "text": prompt},
            ],
        }]
        chat_prompt = model.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )

        chunks = []
        streamer = model.generate(chat_prompt, images=[image_path], max_new_tokens=256, stream=True)
        for chunk in streamer:
            print(chunk, end="", flush=True)
            chunks.append(chunk)
        print()
        return "".join(chunks)
    finally:
        model.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Path to an image file (e.g. a captured camera frame).")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--model", default=DEFAULT_VLM)
    args = parser.parse_args()
    describe_image(args.image, args.prompt, args.model)


if __name__ == "__main__":
    main()
