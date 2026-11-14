import { Injectable } from '@nestjs/common';

import type { RegisteredHost, SignalingSession } from '../models/signaling-session.model.js';
import type { HostSocket } from '../ports/signaling-transport.port.js';


type SessionChange = Partial<Pick<SignalingSession, 'state' | 'candidates'>>;

/** The hosts online and the sessions being negotiated, in memory: a restart only makes hosts and browsers reconnect. */
@Injectable()
export class SignalingRegistryService {
  private readonly hosts = new Map<string, RegisteredHost>();
  private readonly instanceBySocket = new Map<HostSocket, string>();
  private readonly sessions = new Map<string, SignalingSession>();
  private readonly sessionsByInstance = new Map<string, Set<string>>();

  host(instanceId: string): RegisteredHost | undefined {
    return this.hosts.get(instanceId);
  }

  setHost(host: RegisteredHost): void {
    this.hosts.set(host.instanceId, host);
    this.instanceBySocket.set(host.socket, host.instanceId);
  }

  /** Removes the host and returns its sessions, when the socket still holds its instance. */
  removeHost(socket: HostSocket): readonly SignalingSession[] {
    const instanceId = this.instanceBySocket.get(socket);
    this.instanceBySocket.delete(socket);
    if (instanceId === undefined || this.hosts.get(instanceId)?.socket !== socket) {
      return [];
    }
    this.hosts.delete(instanceId);
    const sessions = [...this.sessionsByInstance.get(instanceId) ?? []].map(id => this.sessions.get(id)!);
    sessions.forEach(session => this.removeSession(session.id));
    return sessions;
  }

  session(id: string): SignalingSession | undefined {
    return this.sessions.get(id);
  }

  addSession(session: SignalingSession): void {
    this.sessions.set(session.id, session);
    const ids = this.sessionsByInstance.get(session.instanceId) ?? new Set<string>();
    ids.add(session.id);
    this.sessionsByInstance.set(session.instanceId, ids);
  }

  updateSession(id: string, change: SessionChange): void {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.set(id, { ...session, ...change });
    }
  }

  removeSession(id: string): SignalingSession | undefined {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    this.sessions.delete(id);
    const ids = this.sessionsByInstance.get(session.instanceId)!;
    ids.delete(id);
    if (ids.size === 0) {
      this.sessionsByInstance.delete(session.instanceId);
    }
    return session;
  }

  sessionCount(instanceId: string): number {
    return this.sessionsByInstance.get(instanceId)?.size ?? 0;
  }
}
