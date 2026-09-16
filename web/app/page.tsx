'use client';

import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { useState } from 'react';

export default function Chat() {
  const { messages, sendMessage, addToolApprovalResponse, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState('');

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">SignalGuard chat</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Talking to Qwen3 on your Snapdragon X Elite via GenieX. Physical
        actions on the Arduino Uno Q are gated below.
      </p>

      <div className="my-6 flex flex-col gap-3">
        {messages.map(message => (
          <div key={message.id}>
            <span className="font-medium">
              {message.role === 'user' ? 'You: ' : 'Assistant: '}
            </span>
            {message.parts.map((part, i) => {
              if (part.type === 'text') {
                return <span key={i}>{part.text}</span>;
              }

              if (part.type !== 'dynamic-tool') {
                return null;
              }

              const callId = part.toolCallId;

              switch (part.state) {
                case 'input-streaming':
                case 'input-available':
                  return (
                    <div key={callId} className="text-sm text-neutral-500">
                      [tool] {part.toolName}({JSON.stringify(part.input)})
                    </div>
                  );

                case 'approval-requested': {
                  if (part.approval.isAutomatic) {
                    return (
                      <div key={callId} className="text-sm text-neutral-500">
                        Checking {part.toolName}...
                      </div>
                    );
                  }
                  return (
                    <div
                      key={callId}
                      className="my-2 rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3 dark:bg-amber-950"
                    >
                      <div className="font-semibold text-amber-800 dark:text-amber-300">
                        ⚠️ {part.toolName}({JSON.stringify(part.input)})
                      </div>
                      {part.approval.requestReason && (
                        <p className="my-2 text-sm">{part.approval.requestReason}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white"
                          onClick={() =>
                            addToolApprovalResponse({ id: part.approval.id, approved: true })
                          }
                        >
                          Proceed
                        </button>
                        <button
                          className="rounded border border-amber-600 px-3 py-1 text-sm font-medium text-amber-700 dark:text-amber-300"
                          onClick={() =>
                            addToolApprovalResponse({ id: part.approval.id, approved: false })
                          }
                        >
                          Block
                        </button>
                      </div>
                    </div>
                  );
                }

                case 'approval-responded':
                  return (
                    <div key={callId} className="text-sm text-neutral-500">
                      {part.approval.approved ? 'Approved' : 'Blocked'}
                      {part.approval.isAutomatic ? ' automatically' : ''}.
                    </div>
                  );

                case 'output-available':
                  return (
                    <div key={callId} className="text-sm">
                      [result] {JSON.stringify(part.output)}
                    </div>
                  );

                case 'output-denied':
                  return (
                    <div key={callId} className="text-sm text-red-600">
                      Blocked by SignalGuard.
                    </div>
                  );

                case 'output-error':
                  return (
                    <div key={callId} className="text-sm text-red-600">
                      Error: {part.errorText}
                    </div>
                  );

                default:
                  return null;
              }
            })}
          </div>
        ))}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput('');
          }
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="e.g. Check whether the Arduino is connected"
          disabled={status !== 'ready'}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900"
        />
      </form>
    </main>
  );
}
