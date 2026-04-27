using UnityEngine;

/// Moves the forklift along a straight path at a configurable speed.
/// Attach to the forklift GameObject alongside ClarusEntity.
///
/// Default path: x = 0 → 4 m at 1.4 m/s along the x-axis.
/// The forklift crosses the 5 m threshold relative to a worker at (3.2, 0)
/// at t ≈ 0 (already within 5 m) with TTC ≈ 2.3 s on arrival.
public class ForkliftPath : MonoBehaviour
{
    [Tooltip("World-space start position")]
    public Vector3 startPosition = new Vector3(-1f, 0f, 0f);

    [Tooltip("World-space end position")]
    public Vector3 endPosition = new Vector3(4f, 0f, 0f);

    [Tooltip("Speed in m/s along the path")]
    public float speed = 1.4f;

    [Tooltip("Pause at end before restarting (seconds)")]
    public float pauseAtEnd = 2f;

    private float _t = 0f;
    private bool _pausing = false;
    private float _pauseTimer = 0f;

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
                transform.position = startPosition;
            }
            return;
        }

        float totalDist = Vector3.Distance(startPosition, endPosition);
        _t += speed * Time.deltaTime / totalDist;
        _t = Mathf.Clamp01(_t);

        transform.position = Vector3.Lerp(startPosition, endPosition, _t);

        if (_t >= 1f) _pausing = true;
    }
}
