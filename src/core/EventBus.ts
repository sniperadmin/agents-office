/**
 * Typed EventBus implementation for Agents Office
 * @module core/EventBus
 */

export type EventCallback<T = any> = (data: T) => void;

/**
 * Strongly-typed publish-subscribe EventBus that decouples UI components,
 * 3D scene renderers, and backend state managers.
 */
export class EventBus {
  private static instance: EventBus;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  private constructor() {}

  /**
   * Access singleton instance of EventBus.
   */
  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Subscribe to a named event channel.
   * @param event - Event name (e.g. 'DEPARTMENT_ACTIVATED', 'ROSTER_UPDATED')
   * @param callback - Function invoked when the event is published
   * @returns Unsubscribe function
   */
  public on<T = any>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.off(event, callback);
    };
  }

  /**
   * Unsubscribe a callback from an event channel.
   * @param event - Event name
   * @param callback - Registered listener callback
   */
  public off<T = any>(event: string, callback: EventCallback<T>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Publish data payload to all subscribers of an event channel.
   * @param event - Event name
   * @param data - Payload data object
   */
  public emit<T = any>(event: string, data?: T): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(fn => {
        try {
          fn(data);
        } catch (err) {
          console.error(`[EventBus] Error handling event "${event}":`, err);
        }
      });
    }
  }
}

export const events = EventBus.getInstance();
