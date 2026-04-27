using UnityEngine;

/// Attach to any GameObject that should be tracked by clarus.
/// The exporter reads all active ClarusEntity components in the scene each tick.
public class ClarusEntity : MonoBehaviour
{
    [Tooltip("Unique entity ID sent in every UDP packet (e.g. 'forklift_01', 'worker_01')")]
    public string entityId = "entity_01";

    [Tooltip("Entity class — must match one of the EntityClass variants in clarus-engine")]
    public EntityClass entityClass = EntityClass.Forklift;

    // Velocity is computed by the exporter from frame-to-frame position delta.
    // Store previous position so the exporter can derive vx/vy each tick.
    [HideInInspector] public Vector3 previousPosition;

    void Awake()
    {
        previousPosition = transform.position;
    }
}

/// Must match the EntityClass enum in crates/engine/src/entity.rs exactly.
public enum EntityClass
{
    Forklift,
    ReachStacker,
    TerminalTractor,
    Vessel,
    Person,
}
