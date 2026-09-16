'use client';

import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { riskTier } from '@/lib/risk-registry';

type DynamicToolPart = Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }>;

interface TraceEntry {
  key: string;
  part: DynamicToolPart;
}

function collectTrace(messages: UIMessage[]): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'dynamic-tool') {
        entries.push({ key: `${message.id}-${part.toolCallId}`, part });
      }
    }
  }
  return entries;
}

function TraceRow({ entry, onApprove }: { entry: TraceEntry; onApprove: (id: string, approved: boolean) => void }) {
  const { part } = entry;
  const tier = riskTier(part.toolName);

  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tier === 'SAFE' ? 'secondary' : 'outline'} className="font-mono text-xs">
          {tier}
        </Badge>
        <span className="font-mono text-sm">
          {part.toolName}({JSON.stringify(part.input ?? {})})
        </span>
      </div>

      <div className="mt-1.5 pl-1">
        {part.state === 'approval-requested' && part.approval.isAutomatic && (
          <p className="text-xs text-muted-foreground">Auto-approved - SAFE tool, no review needed.</p>
        )}

        {part.state === 'approval-requested' && !part.approval.isAutomatic && (
          <div className="space-y-2">
            {part.approval.requestReason && (
              <p className="text-sm text-amber-500">{part.approval.requestReason}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onApprove(part.approval.id, true)}>
                Proceed
              </Button>
              <Button size="sm" variant="outline" onClick={() => onApprove(part.approval.id, false)}>
                Block
              </Button>
            </div>
          </div>
        )}

        {part.state === 'approval-responded' && (
          <p className="text-xs text-muted-foreground">
            <Badge variant={part.approval.approved ? 'secondary' : 'destructive'} className="mr-1.5">
              {part.approval.approved ? 'Approved' : 'Blocked'}
            </Badge>
            {part.approval.isAutomatic ? 'automatically' : 'by you'}
            {part.approval.reason ? ` - ${part.approval.reason}` : ''}
          </p>
        )}

        {part.state === 'output-available' && (
          <p className="font-mono text-xs text-muted-foreground">{JSON.stringify(part.output)}</p>
        )}

        {part.state === 'output-denied' && (
          <p className="text-xs text-destructive">Blocked by SignalGuard - not executed.</p>
        )}

        {part.state === 'output-error' && (
          <p className="text-xs text-destructive">Error: {part.errorText}</p>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { messages, sendMessage, addToolApprovalResponse, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState('');

  const trace = useMemo(() => collectTrace(messages), [messages]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SignalGuard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Qwen3 on a Snapdragon X Elite via GenieX, calling MCP tools with a safety gate in front of
          anything not read-only.
        </p>
      </div>

      <Alert>
        <AlertTitle>Why this exists</AlertTitle>
        <AlertDescription>
          Ambiguous instructions can silently resolve to the wrong scope - &quot;remove other
          branches&quot; meaning local when an agent executes it as remote, with no confirmation
          before a destructive MCP tool call runs. Every tool call below is tiered SAFE or
          CONFIRM_REQUIRED and logged in the trace panel, so a scope mismatch gets caught before
          it executes, not after.
        </AlertDescription>
      </Alert>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="flex min-h-[420px] flex-col">
          <CardHeader>
            <CardTitle className="text-base">Chat</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <ScrollArea className="flex-1 pr-2">
              <div className="flex flex-col gap-3">
                {messages.map(message => (
                  <div key={message.id} className="text-sm">
                    <span className="font-medium">{message.role === 'user' ? 'You: ' : 'Assistant: '}</span>
                    {message.parts.map((part, i) => {
                      if (part.type === 'text') {
                        return <span key={i}>{part.text}</span>;
                      }
                      if (part.type === 'dynamic-tool') {
                        return (
                          <span key={i} className="text-muted-foreground">
                            {' '}
                            [used {part.toolName}]
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Separator />

            <form
              className="flex gap-2"
              onSubmit={e => {
                e.preventDefault();
                if (input.trim()) {
                  sendMessage({ text: input });
                  setInput('');
                }
              }}
            >
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="e.g. Check whether the Arduino is connected"
                disabled={status !== 'ready'}
              />
              <Button type="submit" disabled={status !== 'ready' || !input.trim()}>
                Send
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="flex min-h-[420px] flex-col">
          <CardHeader>
            <CardTitle className="text-base">SignalGuard trace</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every tool call, its risk tier, and its approval decision - in order.
            </p>
          </CardHeader>
          <CardContent className="flex-1">
            <ScrollArea className="h-full">
              {trace.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tool calls yet.</p>
              ) : (
                trace.map(entry => (
                  <TraceRow
                    key={entry.key}
                    entry={entry}
                    onApprove={(id, approved) => addToolApprovalResponse({ id, approved })}
                  />
                ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
