// InitDeity 第三方补间（DOTween——state 效应锁定）
using DG.Tweening;
using UnityEngine;

public sealed class DotweenUse : MonoBehaviour
{
    public RectTransform panel;

    void Open()
    {
        panel.DOMove(Vector3.zero, 0.3f).SetEase(Ease.OutQuad);
        panel.DOScale(1f, 0.3f);
    }

    void Close()
    {
        DOTween.Kill(panel);
    }
}
