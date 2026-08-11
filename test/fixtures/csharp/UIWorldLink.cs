// InitDeity UIs/GetRewardBar 模式（UI 世界链接——Camera.main/transform 链 + Update 传染）
using TMPro;
using UnityEngine;

public sealed class GetRewardBar : UI
{
    [SerializeField]
    TMP_Text itemNameText;

    Camera main;
    Transform target;
    Vector2 offset;

    void Awake()
    {
        main = Camera.main;
        offset = transform.parent as RectTransform != null
            ? ((RectTransform)transform.parent).anchoredPosition
            : Vector2.zero;
    }

    public void Init(Transform followTarget, Vector2 followOffset)
    {
        target = followTarget;
        offset = followOffset;
    }

    void Update()
    {
        if (main == null || target == null) return;
        var screenPos = main.WorldToScreenPoint(target.position);
        transform.position = screenPos + (Vector3)offset;
    }
}

public class UI : MonoBehaviour { }
