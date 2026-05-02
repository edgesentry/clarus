using UnityEngine;

/// Moves a vessel east at constant speed toward a restricted zone.
///
/// Coordinate mapping matches the sg-maritime-security scenario:
///   World (x, y):  x = east (metres), y = north (metres)
///   Unity (x, z):  Unity x → world x,  Unity z → world y
///
/// Default path: x = 0 → 700 m at 2 m/s, y = 350 m (centre of zone).
/// Zone polygon: x ∈ [300, 600], y ∈ [200, 500] (from sg-maritime-security/rules.json).
/// RESTRICTED_ZONE_APPROACH fires when the vessel crosses x = 300 m (≈ t = 150 s).
///
/// Attach to the vessel GameObject alongside ClarusEntity.
public class VesselPath : MonoBehaviour
{
    [Tooltip("World-space start position (x=east, z=north in Unity)")]
    public Vector3 startPosition = new Vector3(0f, 0f, 350f);

    [Tooltip("World-space end position")]
    public Vector3 endPosition = new Vector3(700f, 0f, 350f);

    [Tooltip("Speed in m/s — matches vessel_zone_approach.csv (2 m/s)")]
    public float speed = 2f;

    [Tooltip("Pause at end (seconds) before looping back to start")]
    public float pauseAtEnd = 5f;

    [Tooltip("x-coordinate where RESTRICTED_ZONE_APPROACH fires (for logging)")]
    public float zoneEntryX = 300f;

    private float _t = 0f;
    private bool _pausing = false;
    private float _pauseTimer = 0f;
    private bool _alertLogged = false;

    void Start()
    {
        transform.position = startPosition;
    }

    void Update()
    {
        if (_pausing)
        {
            _pauseTimer += Time.deltaTime;
            if (_pauseTimer >= pauseAtEnd)
            {
                _pausing = false;
                _pauseTimer = 0f;
                _t = 0f;
                _alertLogged = false;
                transform.position = startPosition;
            }
            return;
        }

        float totalDist = Vector3.Distance(startPosition, endPosition);
        _t += speed * Time.deltaTime / totalDist;
        _t = Mathf.Clamp01(_t);
        transform.position = Vector3.Lerp(startPosition, endPosition, _t);

        // Log zone entry once per pass (informational only — clarus fires the real alert)
        if (!_alertLogged && transform.position.x >= zoneEntryX)
        {
            _alertLogged = true;
            Debug.Log($"[VesselPath] Zone boundary crossed at x={transform.position.x:F1} m " +
                      $"— RESTRICTED_ZONE_APPROACH should fire in clarus");
        }

        if (_t >= 1f) _pausing = true;
    }

    // Draw the zone polygon and vessel path in the Scene view for alignment.
    void OnDrawGizmos()
    {
        // Vessel path
        Gizmos.color = Color.cyan;
        Gizmos.DrawLine(startPosition, endPosition);
        Gizmos.DrawSphere(startPosition, 3f);

        // Zone boundary (sg-maritime-security default: x ∈ [300,600], y ∈ [200,500])
        Gizmos.color = new Color(1f, 0.2f, 0.2f, 0.5f);
        Vector3 zoneMin = new Vector3(300f, 0f, 200f);
        Vector3 zoneMax = new Vector3(600f, 0f, 500f);
        Vector3 center  = (zoneMin + zoneMax) / 2f;
        Vector3 size    = new Vector3(zoneMax.x - zoneMin.x, 0.1f, zoneMax.z - zoneMin.z);
        Gizmos.DrawCube(center, size);
        Gizmos.color = Color.red;
        Gizmos.DrawWireCube(center, size);

        // Zone entry line
        Gizmos.color = Color.yellow;
        Gizmos.DrawLine(new Vector3(zoneEntryX, 0f, 150f), new Vector3(zoneEntryX, 0f, 550f));
    }
}
